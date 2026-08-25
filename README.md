# Homestead

**[Try the live demo](https://raghavendra-talur.github.io/household-storage/)** —
it runs entirely in your browser: no server, no account, and your sandbox
vanishes when you close the tab.

A calm, exact home for every object in your household. Rooms have a travel
cost (near/far), places have a visibility cue (cue/open/hidden) and a
capacity, and every item has one exact home plus a current location. State
checks (misplaced, lost, over capacity) and design checks (home/placement
match, lifecycle legality) keep the house easy to read. A Quick Capture mode
turns a dump-room clearing session into one item per Enter keypress.

## Architecture

- **Backend** (`server/`): Go, chi router, SQLite via modernc.org/sqlite
  (pure Go, no cgo). One module, `server/modules/household`, owns the whole
  API under `/api/v1`: full dataset reads (`GET /state`), CRUD for rooms,
  places, and items, and a one-time bulk import. Migrations are append-only
  (`server/db`). Data is a single SQLite file under `$XDG_DATA_HOME/homestead`
  (default `~/.local/share/homestead/`), WAL mode, guarded by a flock so two
  instances can't share it.
- **Live sync**: every successful mutation notifies an in-process hub
  (`server/events`) that streams Server-Sent Events at `/api/v1/events`;
  every connected client refetches on each event, so all devices converge in
  real time.
- **Frontend** (`client/`): React + TypeScript + vite. The organizing rules
  live in pure, unit-tested modules (`domain.ts`, `placeTable.ts`,
  `capture.ts`); components stay logic-free. Rows are click-to-edit, and
  destructive actions are two-step confirms inside the edit dialogs.
- **One binary in production**: `vite build` output is embedded via
  `go:embed`; the Go server serves the SPA (with index.html fallback) and the
  API from a single port. In development the server reverse-proxies non-API
  routes to the vite dev server instead, so there is one origin in both modes.

- **Demo build**: `npm run build:demo` compiles the frontend with the API
  client swapped for an in-memory store (`client/src/demoStore.ts`) that
  mirrors the server's semantics — the published demo is pure static files
  with per-tab state (deployed to GitHub Pages by `.github/workflows/demo.yml`).

## Commands

- `make dev` — run the dev server (Go via air + vite HMR)
- `make test` — Go API/storage tests + vitest for the domain logic
- `make lint` / `make build`
- `make install` — build and install as a launchd user agent (macOS)

The server reads `PORT` (required) and optionally `HOST`, `DATA_DIR`, and
`DB_PATH` from the environment. `make dev` and `make install` assume this
machine's tmux/route tooling; on another machine, build with `make build` and
run `bin/homestead` with `PORT` set.

## License

[O'Saasy](https://osaasy.dev/) — see `LICENSE.md`.
