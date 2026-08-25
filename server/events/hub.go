// Package events is a minimal change-notification hub: mutations call
// Notify, and each connected browser holds an SSE stream that turns those
// notifications into "data: changed" events, prompting a state refetch.
package events

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Hub struct {
	mu   sync.Mutex
	subs map[chan struct{}]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[chan struct{}]struct{})}
}

// Subscribe registers a listener. The channel has capacity 1 and Notify never
// blocks on it: a pending signal already means "refetch", so extra ones are
// redundant. Call cancel to unregister.
func (h *Hub) Subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	cancel := func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}
	return ch, cancel
}

// Notify signals every subscriber that state changed.
func (h *Hub) Notify() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- struct{}{}:
		default: // a signal is already pending
		}
	}
}

func (h *Hub) subscriberCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// keepaliveInterval defeats idle timeouts in proxies along the way.
const keepaliveInterval = 25 * time.Second

// ServeHTTP streams change events as Server-Sent Events until the client
// disconnects.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	ch, cancel := h.Subscribe()
	defer cancel()

	ticker := time.NewTicker(keepaliveInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ch:
			fmt.Fprint(w, "data: changed\n\n")
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
