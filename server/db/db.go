package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Open connects to the SQLite database at dbPath (creating the parent
// directory), enables WAL + foreign keys, and runs pending migrations.
func Open(dbPath string) (*sql.DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}

	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(wal)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", dbPath)
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	if err := migrate(conn); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

// migrate applies pending migrations in order, each in a transaction with the
// schema version bumped atomically.
func migrate(conn *sql.DB) error {
	if _, err := conn.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	var current int
	if err := conn.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&current); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}

	for i, m := range migrations {
		ver := i + 1
		if ver <= current {
			continue
		}
		tx, err := conn.Begin()
		if err != nil {
			return fmt.Errorf("migration %d: begin: %w", ver, err)
		}
		if _, err := tx.Exec(m); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d failed: %w", ver, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, ver); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: record version: %w", ver, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("migration %d: commit: %w", ver, err)
		}
		log.Printf("Applied migration %d", ver)
	}
	return nil
}

// ── Migrations ───────────────────────────────────────────────────────────────
// Append-only. Never edit or reorder existing entries.

var migrations = []string{
	// 1: the household domain — rooms contain places, items have a home
	// (a place, nullable) and a current location (place id, IN_USE, or UNKNOWN).
	`
	CREATE TABLE rooms (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		travel TEXT NOT NULL CHECK (travel IN ('NEAR','FAR')),
		notes TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
	CREATE TABLE places (
		id TEXT PRIMARY KEY,
		room_id TEXT NOT NULL REFERENCES rooms(id),
		name TEXT NOT NULL,
		cue TEXT NOT NULL CHECK (cue IN ('CUE','OPEN','HIDDEN')),
		capacity INTEGER NOT NULL CHECK (capacity >= 1),
		notes TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
	CREATE TABLE items (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		lifecycle TEXT NOT NULL CHECK (lifecycle IN ('FIXED','MOBILE','SUPPLIES','PROJECTS','ARCHIVE','INCOMING','OUTGOING')),
		placement TEXT NOT NULL CHECK (placement IN ('NEAR_CUE','NEAR_OPEN','NEAR_HIDDEN','FAR_CUE','FAR_OPEN','FAR_HIDDEN')),
		home TEXT REFERENCES places(id),
		location TEXT NOT NULL,
		notes TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
	`,
}
