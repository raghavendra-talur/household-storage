import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import { pretty, type Data, type Item, type Location, type Place, type Room } from "./domain";
import { CaptureForm } from "./components/CaptureForm";
import { Dialog } from "./components/Dialog";
import { ItemForm, MoveForm, PlaceForm, RoomForm } from "./components/forms";
import { Items, pageTitle, Places, Reports, Today, type Tab } from "./components/views";
import { designIssues, misplacedItems, overloadedPlaces, unknownItems } from "./domain";

type DialogState =
  | { kind: "add-room" }
  | { kind: "edit-room"; room: Room }
  | { kind: "add-place"; roomId?: string }
  | { kind: "edit-place"; place: Place }
  | { kind: "add-item" }
  | { kind: "edit-item"; item: Item }
  | { kind: "move"; item: Item }
  | { kind: "capture" }
  | null;

const TABS: Tab[] = ["home", "places", "items", "reports"];

function tabFromHash(): Tab {
  const name = window.location.hash.replace(/^#\/?/, "");
  return (TABS as string[]).includes(name) ? (name as Tab) : "home";
}

export default function App() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setTab = (next: Tab) => {
    window.location.hash = next === "home" ? "/" : `/${next}`;
  };

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const reload = useCallback(async () => {
    setData(await api.fetchState());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const state = await api.fetchState();
        if (await api.importLegacyLocalStorage(state)) {
          await reload();
        } else {
          setData(state);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [reload]);

  // Freshness: the server pushes a change event (SSE) whenever any device
  // mutates state; refetch on those, and when the tab becomes visible again.
  useEffect(() => {
    const refetch = () => {
      reload().catch(() => {
        // transient network failure — the next event or focus retries
      });
    };
    const unsubscribe = api.subscribeToChanges(refetch);
    const onVisible = () => document.visibilityState === "visible" && refetch();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  // Every mutation funnels through here: run it, refetch, surface failures.
  const mutate = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await reload();
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const moveItem = (item: Item, location: Location) => {
    if (location === "__DEPARTED__") {
      // Confirmation happened in the dialog (two-step DepartButton).
      return mutate(() => api.deleteItem(item.id));
    }
    return mutate(() => api.updateItem(item.id, { location }));
  };

  const itemActions = {
    onMove: (item: Item) => setDialog({ kind: "move", item }),
    onEdit: (item: Item) => setDialog({ kind: "edit-item", item }),
  };

  if (!data) {
    return (
      <main className="app-shell">
        <div className="boot">{error ? `Could not reach the server: ${error}` : "Loading the house…"}</div>
      </main>
    );
  }

  const needsAttention =
    misplacedItems(data).length +
    unknownItems(data).length +
    overloadedPlaces(data).length +
    designIssues(data).filter((x) => x.severity === "error").length;

  return (
    <main className="app-shell">
      {api.IS_DEMO && (
        <div className="demo-banner">
          Demo — everything you change lives only in this tab and vanishes when you close it.
          Reload for a fresh house.
        </div>
      )}
      <aside className="sidebar">
        <button className="brand" onClick={() => setTab("home")}>
          <span className="brand-mark">H</span>
          <span>
            Homestead<small>Everything has a home.</small>
          </span>
        </button>
        <nav aria-label="Primary navigation">
          {TABS.map((key) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
              <span>{key === "home" ? "⌂" : key === "places" ? "▦" : key === "items" ? "◇" : "✓"}</span>
              {key === "home" ? "Today" : pretty(key)}
              {key === "reports" && needsAttention > 0 && <b>{needsAttention}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="pulse" />
          {api.IS_DEMO ? "Sandbox in this tab" : "Shared with the whole house"}
          <button className="text-button" onClick={() => api.exportData(data)}>
            Export
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">HOUSEHOLD OBJECT STORAGE</p>
            <h1>{pageTitle(tab, new Date().getHours())}</h1>
          </div>
          <div className="top-actions">
            <label className="search">
              <span>⌕</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find anything" />
            </label>
            {tab === "places" ? (
              <button className="secondary" onClick={() => setDialog({ kind: "add-room" })}>
                ＋ Add room
              </button>
            ) : (
              <button className="secondary" onClick={() => setDialog({ kind: "capture" })}>
                ⚡ Capture
              </button>
            )}
            <button
              className="primary"
              onClick={() => setDialog({ kind: tab === "places" ? "add-place" : "add-item" })}
            >
              ＋ {tab === "places" ? "Add place" : "Add item"}
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {tab === "home" && <Today data={data} setTab={setTab} actions={itemActions} />}
        {tab === "places" && (
          <Places
            data={data}
            query={query}
            onEditRoom={(room) => setDialog({ kind: "edit-room", room })}
            onEditPlace={(place) => setDialog({ kind: "edit-place", place })}
            onAddPlace={(roomId) => setDialog({ kind: "add-place", roomId })}
          />
        )}
        {tab === "items" && <Items data={data} query={query} actions={itemActions} />}
        {tab === "reports" && <Reports data={data} actions={itemActions} />}
      </section>

      {dialog && (
        <Dialog
          title={
            dialog.kind === "move"
              ? `Move ${dialog.item.name}`
              : dialog.kind === "capture"
                ? "Quick capture"
                : dialog.kind.startsWith("edit-")
                  ? `Edit ${dialog.kind.slice(5)}`
                  : `Add ${dialog.kind.slice(4)}`
          }
          onClose={() => setDialog(null)}
        >
          {error && (
            <div className="error-banner in-modal" role="alert">
              {error}
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}
          {dialog.kind === "add-room" && <RoomForm onSave={(d) => mutate(() => api.createRoom(d))} />}
          {dialog.kind === "edit-room" && (
            <RoomForm
              room={dialog.room}
              onSave={(d) => mutate(() => api.updateRoom(dialog.room.id, d))}
              onDelete={() => mutate(() => api.deleteRoom(dialog.room.id))}
            />
          )}
          {dialog.kind === "add-place" && (
            <PlaceForm
              data={data}
              defaultRoomId={dialog.roomId}
              onRoom={() => setDialog({ kind: "add-room" })}
              onSave={(d) => mutate(() => api.createPlace(d))}
            />
          )}
          {dialog.kind === "edit-place" && (
            <PlaceForm
              data={data}
              place={dialog.place}
              onRoom={() => setDialog({ kind: "add-room" })}
              onSave={(d) => mutate(() => api.updatePlace(dialog.place.id, d))}
              onDelete={() => mutate(() => api.deletePlace(dialog.place.id))}
            />
          )}
          {dialog.kind === "add-item" && (
            <ItemForm data={data} onSave={(d) => mutate(() => api.createItem({ location: "", ...d } as never))} />
          )}
          {dialog.kind === "edit-item" && (
            <ItemForm
              data={data}
              item={dialog.item}
              onSave={(d) => mutate(() => api.updateItem(dialog.item.id, d))}
              onDelete={() => mutate(() => api.deleteItem(dialog.item.id))}
            />
          )}
          {dialog.kind === "move" && (
            <MoveForm data={data} item={dialog.item} onMove={(loc) => moveItem(dialog.item, loc)} />
          )}
          {dialog.kind === "capture" && (
            <CaptureForm
              onChanged={() => {
                reload().catch(() => {
                  // SSE will bring the next refetch
                });
              }}
            />
          )}
        </Dialog>
      )}
    </main>
  );
}
