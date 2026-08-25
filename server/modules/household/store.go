package household

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"slices"
)

// The organizing domain: rooms contain places; each item has a required
// placement, an optional home (a place), and a current location — a place id
// or one of the LocationInUse / LocationUnknown sentinels. Design-rule
// checking (home/placement match, lifecycle legality) lives in the client;
// the server owns referential integrity and enums.

const (
	LocationInUse   = "IN_USE"
	LocationUnknown = "UNKNOWN"
)

var (
	travels    = []string{"NEAR", "FAR"}
	cues       = []string{"CUE", "OPEN", "HIDDEN"}
	lifecycles = []string{"FIXED", "MOBILE", "SUPPLIES", "PROJECTS", "ARCHIVE", "INCOMING", "OUTGOING"}
	placements = []string{"NEAR_CUE", "NEAR_OPEN", "NEAR_HIDDEN", "FAR_CUE", "FAR_OPEN", "FAR_HIDDEN"}
)

type Room struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Travel string `json:"travel"`
	Notes  string `json:"notes"`
}

type Place struct {
	ID       string `json:"id"`
	RoomID   string `json:"roomId"`
	Name     string `json:"name"`
	Cue      string `json:"cue"`
	Capacity int    `json:"capacity"`
	Notes    string `json:"notes"`
}

type Item struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Lifecycle string  `json:"lifecycle"`
	Placement string  `json:"placement"`
	Home      *string `json:"home"`
	Location  string  `json:"location"`
	Notes     string  `json:"notes"`
}

type State struct {
	Rooms  []Room  `json:"rooms"`
	Places []Place `json:"places"`
	Items  []Item  `json:"items"`
}

// ValidationError distinguishes bad input (HTTP 400) from storage failures.
type ValidationError struct{ msg string }

func (e ValidationError) Error() string { return e.msg }

func invalidf(format string, args ...any) error {
	return ValidationError{msg: fmt.Sprintf(format, args...)}
}

// ErrNotFound / ErrConflict map to HTTP 404 / 409.
var (
	ErrNotFound = fmt.Errorf("not found")
	ErrConflict = fmt.Errorf("conflict")
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) State() (State, error) {
	state := State{Rooms: []Room{}, Places: []Place{}, Items: []Item{}}

	rows, err := s.db.Query(`SELECT id, name, travel, notes FROM rooms ORDER BY created_at, id`)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	for rows.Next() {
		var r Room
		if err := rows.Scan(&r.ID, &r.Name, &r.Travel, &r.Notes); err != nil {
			return state, err
		}
		state.Rooms = append(state.Rooms, r)
	}

	prows, err := s.db.Query(`SELECT id, room_id, name, cue, capacity, notes FROM places ORDER BY created_at, id`)
	if err != nil {
		return state, err
	}
	defer prows.Close()
	for prows.Next() {
		var p Place
		if err := prows.Scan(&p.ID, &p.RoomID, &p.Name, &p.Cue, &p.Capacity, &p.Notes); err != nil {
			return state, err
		}
		state.Places = append(state.Places, p)
	}

	irows, err := s.db.Query(`SELECT id, name, lifecycle, placement, home, location, notes FROM items ORDER BY created_at, id`)
	if err != nil {
		return state, err
	}
	defer irows.Close()
	for irows.Next() {
		var i Item
		if err := irows.Scan(&i.ID, &i.Name, &i.Lifecycle, &i.Placement, &i.Home, &i.Location, &i.Notes); err != nil {
			return state, err
		}
		state.Items = append(state.Items, i)
	}
	return state, nil
}

func (s *Store) validateRoom(r Room) error {
	if r.Name == "" {
		return invalidf("room name is required")
	}
	if !slices.Contains(travels, r.Travel) {
		return invalidf("travel must be one of %v", travels)
	}
	return nil
}

func (s *Store) CreateRoom(r Room) (Room, error) {
	if err := s.validateRoom(r); err != nil {
		return Room{}, err
	}
	r.ID = newID()
	_, err := s.db.Exec(`INSERT INTO rooms (id, name, travel, notes) VALUES (?,?,?,?)`,
		r.ID, r.Name, r.Travel, r.Notes)
	return r, err
}

func (s *Store) UpdateRoom(id string, r Room) (Room, error) {
	if err := s.validateRoom(r); err != nil {
		return Room{}, err
	}
	res, err := s.db.Exec(`UPDATE rooms SET name=?, travel=?, notes=? WHERE id=?`,
		r.Name, r.Travel, r.Notes, id)
	if err != nil {
		return Room{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Room{}, ErrNotFound
	}
	r.ID = id
	return r, nil
}

func (s *Store) DeleteRoom(id string) error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM places WHERE room_id=?`, id).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("%w: room still has %d places", ErrConflict, count)
	}
	res, err := s.db.Exec(`DELETE FROM rooms WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) validatePlace(p Place) error {
	if p.Name == "" {
		return invalidf("place name is required")
	}
	if !slices.Contains(cues, p.Cue) {
		return invalidf("cue must be one of %v", cues)
	}
	if p.Capacity < 1 {
		return invalidf("capacity must be at least 1")
	}
	var exists int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM rooms WHERE id=?`, p.RoomID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return invalidf("room %q does not exist", p.RoomID)
	}
	return nil
}

func (s *Store) CreatePlace(p Place) (Place, error) {
	if err := s.validatePlace(p); err != nil {
		return Place{}, err
	}
	p.ID = newID()
	_, err := s.db.Exec(`INSERT INTO places (id, room_id, name, cue, capacity, notes) VALUES (?,?,?,?,?,?)`,
		p.ID, p.RoomID, p.Name, p.Cue, p.Capacity, p.Notes)
	return p, err
}

func (s *Store) UpdatePlace(id string, p Place) (Place, error) {
	if err := s.validatePlace(p); err != nil {
		return Place{}, err
	}
	res, err := s.db.Exec(`UPDATE places SET room_id=?, name=?, cue=?, capacity=?, notes=? WHERE id=?`,
		p.RoomID, p.Name, p.Cue, p.Capacity, p.Notes, id)
	if err != nil {
		return Place{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Place{}, ErrNotFound
	}
	p.ID = id
	return p, nil
}

// DeletePlace removes the place and orphans affected items: home references
// are cleared, and items physically located there become UNKNOWN.
func (s *Store) DeletePlace(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE items SET home=NULL WHERE home=?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE items SET location=? WHERE location=?`, LocationUnknown, id); err != nil {
		return err
	}
	res, err := tx.Exec(`DELETE FROM places WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (s *Store) validateItem(i Item) error {
	if i.Name == "" {
		return invalidf("item name is required")
	}
	if !slices.Contains(lifecycles, i.Lifecycle) {
		return invalidf("lifecycle must be one of %v", lifecycles)
	}
	if !slices.Contains(placements, i.Placement) {
		return invalidf("placement must be one of %v", placements)
	}
	if i.Home != nil {
		if ok, err := s.placeExists(*i.Home); err != nil {
			return err
		} else if !ok {
			return invalidf("home place %q does not exist", *i.Home)
		}
	}
	if i.Location != LocationInUse && i.Location != LocationUnknown {
		if ok, err := s.placeExists(i.Location); err != nil {
			return err
		} else if !ok {
			return invalidf("location %q does not exist", i.Location)
		}
	}
	return nil
}

func (s *Store) placeExists(id string) (bool, error) {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM places WHERE id=?`, id).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// CreateItem defaults an empty location to the item's home, or UNKNOWN when
// homeless — a homeless item's whereabouts are by definition not tracked.
func (s *Store) CreateItem(i Item) (Item, error) {
	if i.Location == "" {
		if i.Home != nil {
			i.Location = *i.Home
		} else {
			i.Location = LocationUnknown
		}
	}
	if err := s.validateItem(i); err != nil {
		return Item{}, err
	}
	i.ID = newID()
	_, err := s.db.Exec(`INSERT INTO items (id, name, lifecycle, placement, home, location, notes) VALUES (?,?,?,?,?,?,?)`,
		i.ID, i.Name, i.Lifecycle, i.Placement, i.Home, i.Location, i.Notes)
	return i, err
}

func (s *Store) GetItem(id string) (Item, error) {
	var i Item
	err := s.db.QueryRow(`SELECT id, name, lifecycle, placement, home, location, notes FROM items WHERE id=?`, id).
		Scan(&i.ID, &i.Name, &i.Lifecycle, &i.Placement, &i.Home, &i.Location, &i.Notes)
	if err == sql.ErrNoRows {
		return Item{}, ErrNotFound
	}
	return i, err
}

func (s *Store) UpdateItem(id string, i Item) (Item, error) {
	if err := s.validateItem(i); err != nil {
		return Item{}, err
	}
	res, err := s.db.Exec(`UPDATE items SET name=?, lifecycle=?, placement=?, home=?, location=?, notes=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
		i.Name, i.Lifecycle, i.Placement, i.Home, i.Location, i.Notes, id)
	if err != nil {
		return Item{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Item{}, ErrNotFound
	}
	i.ID = id
	return i, nil
}

func (s *Store) DeleteItem(id string) error {
	res, err := s.db.Exec(`DELETE FROM items WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Import loads a full dataset (e.g. from a browser's localStorage export)
// into an EMPTY database, preserving the payload's ids.
func (s *Store) Import(state State) error {
	current, err := s.State()
	if err != nil {
		return err
	}
	if len(current.Rooms)+len(current.Places)+len(current.Items) > 0 {
		return fmt.Errorf("%w: database is not empty", ErrConflict)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, r := range state.Rooms {
		if err := s.validateRoom(r); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO rooms (id, name, travel, notes) VALUES (?,?,?,?)`,
			r.ID, r.Name, r.Travel, r.Notes); err != nil {
			return err
		}
	}
	for _, p := range state.Places {
		if _, err := tx.Exec(`INSERT INTO places (id, room_id, name, cue, capacity, notes) VALUES (?,?,?,?,?,?)`,
			p.ID, p.RoomID, p.Name, p.Cue, p.Capacity, p.Notes); err != nil {
			return err
		}
	}
	for _, i := range state.Items {
		if i.Location == "" {
			i.Location = LocationUnknown
		}
		if _, err := tx.Exec(`INSERT INTO items (id, name, lifecycle, placement, home, location, notes) VALUES (?,?,?,?,?,?,?)`,
			i.ID, i.Name, i.Lifecycle, i.Placement, i.Home, i.Location, i.Notes); err != nil {
			return err
		}
	}
	return tx.Commit()
}
