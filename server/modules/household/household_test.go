package household

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/raghavendra-talur/household-storage/server/db"
)

func newTestServer(t *testing.T) *httptest.Server {
	ts, _ := newTestServerCounting(t)
	return ts
}

func newTestServerCounting(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	notified := 0
	r := chi.NewRouter()
	r.Route("/api/v1", func(v1 chi.Router) {
		RegisterRoutes(v1, NewStore(conn), func() { notified++ })
	})
	ts := httptest.NewServer(r)
	t.Cleanup(ts.Close)
	return ts, &notified
}

func TestMutationsNotifyChangeListeners(t *testing.T) {
	ts, notified := newTestServerCounting(t)

	room := mustCreateRoom(t, ts, "Office", "NEAR")
	if *notified != 1 {
		t.Fatalf("create room: notified %d times, want 1", *notified)
	}

	getState(t, ts)
	if *notified != 1 {
		t.Fatalf("read-only GET must not notify, got %d", *notified)
	}

	if resp, _ := do(t, ts, "POST", "/api/v1/rooms", map[string]any{"name": "", "travel": "NEAR"}); resp.StatusCode != 400 {
		t.Fatal("setup: expected 400")
	}
	if *notified != 1 {
		t.Fatalf("failed mutation must not notify, got %d", *notified)
	}

	do(t, ts, "PATCH", "/api/v1/rooms/"+room.ID, map[string]any{"name": "Studio"})
	do(t, ts, "DELETE", "/api/v1/rooms/"+room.ID, nil)
	if *notified != 3 {
		t.Fatalf("after update+delete: notified %d times, want 3", *notified)
	}
}

func do(t *testing.T, ts *httptest.Server, method, path string, body any) (*http.Response, []byte) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, ts.URL+path, &buf)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out bytes.Buffer
	out.ReadFrom(resp.Body)
	return resp, out.Bytes()
}

func getState(t *testing.T, ts *httptest.Server) State {
	t.Helper()
	resp, body := do(t, ts, "GET", "/api/v1/state", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("GET state: %d %s", resp.StatusCode, body)
	}
	var s State
	if err := json.Unmarshal(body, &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func decode[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return v
}

func mustCreateRoom(t *testing.T, ts *httptest.Server, name, travel string) Room {
	t.Helper()
	resp, body := do(t, ts, "POST", "/api/v1/rooms", map[string]any{"name": name, "travel": travel})
	if resp.StatusCode != 201 {
		t.Fatalf("create room: %d %s", resp.StatusCode, body)
	}
	return decode[Room](t, body)
}

func mustCreatePlace(t *testing.T, ts *httptest.Server, roomID, name, cue string, capacity int) Place {
	t.Helper()
	resp, body := do(t, ts, "POST", "/api/v1/places", map[string]any{
		"roomId": roomID, "name": name, "cue": cue, "capacity": capacity,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create place: %d %s", resp.StatusCode, body)
	}
	return decode[Place](t, body)
}

func mustCreateItem(t *testing.T, ts *httptest.Server, body map[string]any) Item {
	t.Helper()
	resp, raw := do(t, ts, "POST", "/api/v1/items", body)
	if resp.StatusCode != 201 {
		t.Fatalf("create item: %d %s", resp.StatusCode, raw)
	}
	return decode[Item](t, raw)
}

func TestStateStartsEmpty(t *testing.T) {
	ts := newTestServer(t)
	s := getState(t, ts)
	if len(s.Rooms)+len(s.Places)+len(s.Items) != 0 {
		t.Fatalf("expected empty state, got %+v", s)
	}
	// Arrays must serialize as [], not null, for the client.
	_, body := do(t, ts, "GET", "/api/v1/state", nil)
	if bytes.Contains(body, []byte("null")) {
		t.Fatalf("state contains null arrays: %s", body)
	}
}

func TestRoomCRUD(t *testing.T) {
	ts := newTestServer(t)
	room := mustCreateRoom(t, ts, "Kitchen", "NEAR")
	if room.ID == "" || room.Name != "Kitchen" || room.Travel != "NEAR" {
		t.Fatalf("bad room: %+v", room)
	}

	resp, _ := do(t, ts, "POST", "/api/v1/rooms", map[string]any{"name": "X", "travel": "SIDEWAYS"})
	if resp.StatusCode != 400 {
		t.Fatalf("invalid travel accepted: %d", resp.StatusCode)
	}
	resp, _ = do(t, ts, "POST", "/api/v1/rooms", map[string]any{"name": "", "travel": "NEAR"})
	if resp.StatusCode != 400 {
		t.Fatalf("empty name accepted: %d", resp.StatusCode)
	}

	resp, body := do(t, ts, "PATCH", "/api/v1/rooms/"+room.ID, map[string]any{"name": "Kitchenette", "travel": "FAR", "notes": "n"})
	if resp.StatusCode != 200 {
		t.Fatalf("update room: %d %s", resp.StatusCode, body)
	}
	s := getState(t, ts)
	if s.Rooms[0].Name != "Kitchenette" || s.Rooms[0].Travel != "FAR" || s.Rooms[0].Notes != "n" {
		t.Fatalf("update not applied: %+v", s.Rooms[0])
	}

	resp, _ = do(t, ts, "DELETE", "/api/v1/rooms/"+room.ID, nil)
	if resp.StatusCode != 204 {
		t.Fatalf("delete room: %d", resp.StatusCode)
	}
	if len(getState(t, ts).Rooms) != 0 {
		t.Fatal("room not deleted")
	}
	resp, _ = do(t, ts, "DELETE", "/api/v1/rooms/"+room.ID, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("delete missing room: %d", resp.StatusCode)
	}
}

func TestDeleteRoomWithPlacesRefused(t *testing.T) {
	ts := newTestServer(t)
	room := mustCreateRoom(t, ts, "Office", "NEAR")
	place := mustCreatePlace(t, ts, room.ID, "Shelf", "OPEN", 5)

	resp, _ := do(t, ts, "DELETE", "/api/v1/rooms/"+room.ID, nil)
	if resp.StatusCode != 409 {
		t.Fatalf("room with places deleted: %d", resp.StatusCode)
	}
	if resp, _ := do(t, ts, "DELETE", "/api/v1/places/"+place.ID, nil); resp.StatusCode != 204 {
		t.Fatal("delete place failed")
	}
	if resp, _ := do(t, ts, "DELETE", "/api/v1/rooms/"+room.ID, nil); resp.StatusCode != 204 {
		t.Fatal("delete emptied room failed")
	}
}

func TestPlaceValidation(t *testing.T) {
	ts := newTestServer(t)
	resp, _ := do(t, ts, "POST", "/api/v1/places", map[string]any{"roomId": "nope", "name": "X", "cue": "OPEN", "capacity": 3})
	if resp.StatusCode != 400 {
		t.Fatalf("place with unknown room accepted: %d", resp.StatusCode)
	}
	room := mustCreateRoom(t, ts, "Office", "NEAR")
	resp, _ = do(t, ts, "POST", "/api/v1/places", map[string]any{"roomId": room.ID, "name": "X", "cue": "GLOWING", "capacity": 3})
	if resp.StatusCode != 400 {
		t.Fatalf("invalid cue accepted: %d", resp.StatusCode)
	}
	resp, _ = do(t, ts, "POST", "/api/v1/places", map[string]any{"roomId": room.ID, "name": "X", "cue": "OPEN", "capacity": 0})
	if resp.StatusCode != 400 {
		t.Fatalf("capacity 0 accepted: %d", resp.StatusCode)
	}
}

func TestItemLifecycleFlow(t *testing.T) {
	ts := newTestServer(t)
	room := mustCreateRoom(t, ts, "Office", "NEAR")
	shelf := mustCreatePlace(t, ts, room.ID, "Shelf", "OPEN", 5)
	desk := mustCreatePlace(t, ts, room.ID, "Desk", "CUE", 3)

	item := mustCreateItem(t, ts, map[string]any{
		"name": "Stapler", "lifecycle": "MOBILE", "placement": "NEAR_OPEN", "home": shelf.ID,
	})
	if item.Home == nil || *item.Home != shelf.ID {
		t.Fatalf("home not set: %+v", item)
	}
	if item.Location != shelf.ID {
		t.Fatalf("location should default to home, got %q", item.Location)
	}

	// Homeless item defaults to UNKNOWN, not IN_USE.
	stray := mustCreateItem(t, ts, map[string]any{
		"name": "Mystery cable", "lifecycle": "MOBILE", "placement": "NEAR_HIDDEN",
	})
	if stray.Home != nil || stray.Location != "UNKNOWN" {
		t.Fatalf("homeless item defaults wrong: %+v", stray)
	}

	// Re-home + rename + move in one PATCH.
	resp, body := do(t, ts, "PATCH", "/api/v1/items/"+item.ID, map[string]any{
		"name": "Red stapler", "home": desk.ID, "location": "IN_USE", "lifecycle": "FIXED", "placement": "NEAR_CUE",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("update item: %d %s", resp.StatusCode, body)
	}
	got := decode[Item](t, body)
	if got.Name != "Red stapler" || *got.Home != desk.ID || got.Location != "IN_USE" || got.Lifecycle != "FIXED" {
		t.Fatalf("update not applied: %+v", got)
	}

	// Clearing home via explicit null.
	resp, body = do(t, ts, "PATCH", "/api/v1/items/"+item.ID, map[string]any{"home": nil})
	if resp.StatusCode != 200 {
		t.Fatalf("clear home: %d %s", resp.StatusCode, body)
	}
	if got := decode[Item](t, body); got.Home != nil {
		t.Fatalf("home not cleared: %+v", got)
	}

	// Bad references and enums.
	if resp, _ := do(t, ts, "PATCH", "/api/v1/items/"+item.ID, map[string]any{"home": "nope"}); resp.StatusCode != 400 {
		t.Fatal("unknown home accepted")
	}
	if resp, _ := do(t, ts, "PATCH", "/api/v1/items/"+item.ID, map[string]any{"location": "nope"}); resp.StatusCode != 400 {
		t.Fatal("unknown location accepted")
	}
	if resp, _ := do(t, ts, "POST", "/api/v1/items", map[string]any{"name": "X", "lifecycle": "WEIRD", "placement": "NEAR_CUE"}); resp.StatusCode != 400 {
		t.Fatal("invalid lifecycle accepted")
	}

	// Delete (the OUTGOING "left the house" completion).
	if resp, _ := do(t, ts, "DELETE", "/api/v1/items/"+item.ID, nil); resp.StatusCode != 204 {
		t.Fatal("delete item failed")
	}
	if len(getState(t, ts).Items) != 1 {
		t.Fatal("item not deleted")
	}
}

func TestDeletePlaceOrphansItems(t *testing.T) {
	ts := newTestServer(t)
	room := mustCreateRoom(t, ts, "Office", "NEAR")
	shelf := mustCreatePlace(t, ts, room.ID, "Shelf", "OPEN", 5)
	desk := mustCreatePlace(t, ts, room.ID, "Desk", "CUE", 3)

	homed := mustCreateItem(t, ts, map[string]any{
		"name": "Book", "lifecycle": "FIXED", "placement": "NEAR_OPEN", "home": shelf.ID,
	})
	visitor := mustCreateItem(t, ts, map[string]any{
		"name": "Mug", "lifecycle": "MOBILE", "placement": "NEAR_CUE", "home": desk.ID, "location": shelf.ID,
	})

	if resp, _ := do(t, ts, "DELETE", "/api/v1/places/"+shelf.ID, nil); resp.StatusCode != 204 {
		t.Fatal("delete place failed")
	}
	s := getState(t, ts)
	byID := map[string]Item{}
	for _, i := range s.Items {
		byID[i.ID] = i
	}
	if byID[homed.ID].Home != nil || byID[homed.ID].Location != "UNKNOWN" {
		t.Fatalf("homed item not orphaned: %+v", byID[homed.ID])
	}
	if byID[visitor.ID].Home == nil || byID[visitor.ID].Location != "UNKNOWN" {
		t.Fatalf("visiting item mishandled: %+v", byID[visitor.ID])
	}
}

func TestImport(t *testing.T) {
	ts := newTestServer(t)
	payload := State{
		Rooms:  []Room{{ID: "office", Name: "Office", Travel: "NEAR"}},
		Places: []Place{{ID: "shelf", RoomID: "office", Name: "Shelf", Cue: "OPEN", Capacity: 6}},
		Items: []Item{{
			ID: "yoga", Name: "Yoga mat", Lifecycle: "FIXED", Placement: "NEAR_OPEN",
			Home: ptr("shelf"), Location: "shelf",
		}},
	}
	resp, body := do(t, ts, "POST", "/api/v1/import", payload)
	if resp.StatusCode != 200 {
		t.Fatalf("import: %d %s", resp.StatusCode, body)
	}
	s := getState(t, ts)
	if len(s.Rooms) != 1 || len(s.Places) != 1 || len(s.Items) != 1 || s.Items[0].ID != "yoga" {
		t.Fatalf("import state wrong: %+v", s)
	}

	// Import is only allowed into an empty database.
	resp, _ = do(t, ts, "POST", "/api/v1/import", payload)
	if resp.StatusCode != 409 {
		t.Fatalf("second import accepted: %d", resp.StatusCode)
	}
}

func ptr(s string) *string { return &s }
