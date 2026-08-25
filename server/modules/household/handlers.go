package household

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// RegisterRoutes wires the API. notify is called after every successful
// mutation so change listeners (the SSE hub) can fan out a refetch signal.
func RegisterRoutes(r chi.Router, s *Store, notify func()) {
	h := &handlers{store: s, notify: notify}

	r.Get("/state", h.state)
	r.Post("/import", h.importState)

	r.Post("/rooms", h.createRoom)
	r.Patch("/rooms/{id}", h.updateRoom)
	r.Delete("/rooms/{id}", h.deleteRoom)

	r.Post("/places", h.createPlace)
	r.Patch("/places/{id}", h.updatePlace)
	r.Delete("/places/{id}", h.deletePlace)

	r.Post("/items", h.createItem)
	r.Patch("/items/{id}", h.updateItem)
	r.Delete("/items/{id}", h.deleteItem)
}

type handlers struct {
	store  *Store
	notify func()
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeError maps store errors to status codes: bad input 400, missing 404,
// integrity conflicts 409, everything else 500.
func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	var verr ValidationError
	switch {
	case errors.As(err, &verr):
		status = http.StatusBadRequest
	case errors.Is(err, ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, ErrConflict):
		status = http.StatusConflict
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func decodeBody(r *http.Request, v any) error {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return invalidf("invalid JSON body: %v", err)
	}
	return nil
}

func (h *handlers) state(w http.ResponseWriter, r *http.Request) {
	s, err := h.store.State()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

func (h *handlers) importState(w http.ResponseWriter, r *http.Request) {
	var s State
	if err := decodeBody(r, &s); err != nil {
		writeError(w, err)
		return
	}
	if err := h.store.Import(s); err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	h.state(w, r)
}

// ── Rooms ────────────────────────────────────────────────────────────────────

func (h *handlers) createRoom(w http.ResponseWriter, r *http.Request) {
	var room Room
	if err := decodeBody(r, &room); err != nil {
		writeError(w, err)
		return
	}
	created, err := h.store.CreateRoom(room)
	if err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	writeJSON(w, http.StatusCreated, created)
}

func (h *handlers) updateRoom(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	current, err := h.roomByID(id)
	if err != nil {
		writeError(w, err)
		return
	}
	var patch struct {
		Name   *string `json:"name"`
		Travel *string `json:"travel"`
		Notes  *string `json:"notes"`
	}
	if err := decodeBody(r, &patch); err != nil {
		writeError(w, err)
		return
	}
	applyString(&current.Name, patch.Name)
	applyString(&current.Travel, patch.Travel)
	applyString(&current.Notes, patch.Notes)
	updated, err := h.store.UpdateRoom(id, current)
	if err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	writeJSON(w, http.StatusOK, updated)
}

func (h *handlers) deleteRoom(w http.ResponseWriter, r *http.Request) {
	if err := h.store.DeleteRoom(chi.URLParam(r, "id")); err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) roomByID(id string) (Room, error) {
	s, err := h.store.State()
	if err != nil {
		return Room{}, err
	}
	for _, room := range s.Rooms {
		if room.ID == id {
			return room, nil
		}
	}
	return Room{}, ErrNotFound
}

// ── Places ───────────────────────────────────────────────────────────────────

func (h *handlers) createPlace(w http.ResponseWriter, r *http.Request) {
	var place Place
	if err := decodeBody(r, &place); err != nil {
		writeError(w, err)
		return
	}
	created, err := h.store.CreatePlace(place)
	if err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	writeJSON(w, http.StatusCreated, created)
}

func (h *handlers) updatePlace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	current, err := h.placeByID(id)
	if err != nil {
		writeError(w, err)
		return
	}
	var patch struct {
		RoomID   *string `json:"roomId"`
		Name     *string `json:"name"`
		Cue      *string `json:"cue"`
		Capacity *int    `json:"capacity"`
		Notes    *string `json:"notes"`
	}
	if err := decodeBody(r, &patch); err != nil {
		writeError(w, err)
		return
	}
	applyString(&current.RoomID, patch.RoomID)
	applyString(&current.Name, patch.Name)
	applyString(&current.Cue, patch.Cue)
	if patch.Capacity != nil {
		current.Capacity = *patch.Capacity
	}
	applyString(&current.Notes, patch.Notes)
	updated, err := h.store.UpdatePlace(id, current)
	if err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	writeJSON(w, http.StatusOK, updated)
}

func (h *handlers) deletePlace(w http.ResponseWriter, r *http.Request) {
	if err := h.store.DeletePlace(chi.URLParam(r, "id")); err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) placeByID(id string) (Place, error) {
	s, err := h.store.State()
	if err != nil {
		return Place{}, err
	}
	for _, place := range s.Places {
		if place.ID == id {
			return place, nil
		}
	}
	return Place{}, ErrNotFound
}

// ── Items ────────────────────────────────────────────────────────────────────

func (h *handlers) createItem(w http.ResponseWriter, r *http.Request) {
	var item Item
	if err := decodeBody(r, &item); err != nil {
		writeError(w, err)
		return
	}
	created, err := h.store.CreateItem(item)
	if err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	writeJSON(w, http.StatusCreated, created)
}

func (h *handlers) updateItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	current, err := h.store.GetItem(id)
	if err != nil {
		writeError(w, err)
		return
	}
	// Home needs three-state decoding: absent (keep), null (clear), value (set).
	var patch struct {
		Name      *string         `json:"name"`
		Lifecycle *string         `json:"lifecycle"`
		Placement *string         `json:"placement"`
		Home      json.RawMessage `json:"home"`
		Location  *string         `json:"location"`
		Notes     *string         `json:"notes"`
	}
	if err := decodeBody(r, &patch); err != nil {
		writeError(w, err)
		return
	}
	applyString(&current.Name, patch.Name)
	applyString(&current.Lifecycle, patch.Lifecycle)
	applyString(&current.Placement, patch.Placement)
	applyString(&current.Location, patch.Location)
	applyString(&current.Notes, patch.Notes)
	if patch.Home != nil {
		if bytes.Equal(bytes.TrimSpace(patch.Home), []byte("null")) {
			current.Home = nil
		} else {
			var home string
			if err := json.Unmarshal(patch.Home, &home); err != nil {
				writeError(w, invalidf("home must be a place id or null"))
				return
			}
			current.Home = &home
		}
	}
	updated, err := h.store.UpdateItem(id, current)
	if err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	writeJSON(w, http.StatusOK, updated)
}

func (h *handlers) deleteItem(w http.ResponseWriter, r *http.Request) {
	if err := h.store.DeleteItem(chi.URLParam(r, "id")); err != nil {
		writeError(w, err)
		return
	}
	h.notify()
	w.WriteHeader(http.StatusNoContent)
}

func applyString(dst *string, src *string) {
	if src != nil {
		*dst = *src
	}
}
