package events

import (
	"bufio"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSubscribeReceivesNotify(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe()
	defer cancel()

	h.Notify()
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("subscriber did not receive notification")
	}
}

func TestNotifyDoesNotBlockOnSlowSubscriber(t *testing.T) {
	h := NewHub()
	_, cancel := h.Subscribe()
	defer cancel()

	done := make(chan struct{})
	go func() {
		for i := 0; i < 10; i++ {
			h.Notify() // subscriber never reads; must not block
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Notify blocked on a slow subscriber")
	}
}

func TestCancelRemovesSubscriber(t *testing.T) {
	h := NewHub()
	_, cancel := h.Subscribe()
	cancel()
	if n := h.subscriberCount(); n != 0 {
		t.Fatalf("expected 0 subscribers after cancel, got %d", n)
	}
}

func TestSSEHandlerStreamsEvents(t *testing.T) {
	h := NewHub()
	ts := httptest.NewServer(h)
	defer ts.Close()

	resp, err := ts.Client().Get(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("wrong content type %q", ct)
	}

	lines := make(chan string, 10)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
	}()

	// Wait until the subscription is registered, then fire a change.
	deadline := time.After(2 * time.Second)
	for h.subscriberCount() == 0 {
		select {
		case <-deadline:
			t.Fatal("handler never subscribed")
		case <-time.After(10 * time.Millisecond):
		}
	}
	h.Notify()

	timeout := time.After(2 * time.Second)
	for {
		select {
		case line := <-lines:
			if strings.HasPrefix(line, "data:") {
				return // got the event
			}
		case <-timeout:
			t.Fatal("no data event received")
		}
	}
}
