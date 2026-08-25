import type { Data, Item, Place, Room } from "./domain";
import * as demo from "./demoStore";

// Thin typed client for the Go API. Every mutation resolves to nothing; the
// caller refetches state so all derived views stay consistent.
//
// Demo builds (VITE_DEMO=1) swap every call for the in-browser demoStore:
// same semantics, no server, state gone on tab close.

export const IS_DEMO = import.meta.env.VITE_DEMO === "1";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) {
    let message = `${method} ${path} failed (${resp.status})`;
    try {
      const data = (await resp.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep the generic message
    }
    throw new ApiError(message, resp.status);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export const fetchState = IS_DEMO ? demo.fetchState : () => request<Data>("GET", "/state");

export const createRoom = IS_DEMO
  ? demo.createRoom
  : (room: Omit<Room, "id">) => request<Room>("POST", "/rooms", room);
export const updateRoom = IS_DEMO
  ? demo.updateRoom
  : (id: string, patch: Partial<Omit<Room, "id">>) => request<Room>("PATCH", `/rooms/${id}`, patch);
export const deleteRoom = IS_DEMO
  ? demo.deleteRoom
  : (id: string) => request<void>("DELETE", `/rooms/${id}`);

export const createPlace = IS_DEMO
  ? demo.createPlace
  : (place: Omit<Place, "id">) => request<Place>("POST", "/places", place);
export const updatePlace = IS_DEMO
  ? demo.updatePlace
  : (id: string, patch: Partial<Omit<Place, "id">>) =>
      request<Place>("PATCH", `/places/${id}`, patch);
export const deletePlace = IS_DEMO
  ? demo.deletePlace
  : (id: string) => request<void>("DELETE", `/places/${id}`);

export const createItem = IS_DEMO
  ? demo.createItem
  : (item: Omit<Item, "id">) => request<Item>("POST", "/items", item);
export const updateItem = IS_DEMO
  ? demo.updateItem
  : (id: string, patch: Partial<Omit<Item, "id">>) => request<Item>("PATCH", `/items/${id}`, patch);
export const deleteItem = IS_DEMO
  ? demo.deleteItem
  : (id: string) => request<void>("DELETE", `/items/${id}`);

// subscribeToChanges opens the server's SSE stream and invokes onChange
// whenever any device mutates state (and on each (re)connect, to catch up on
// anything missed while disconnected). Returns an unsubscribe function.
export function subscribeToChanges(onChange: () => void): () => void {
  if (IS_DEMO) return () => {}; // no server, no other devices to hear from
  const source = new EventSource("/api/v1/events");
  source.onmessage = onChange;
  source.onopen = onChange;
  return () => source.close();
}

const LEGACY_KEY = "household-storage-v1";

// One-time migration: earlier versions kept the whole dataset in this
// browser's localStorage. If the server is empty and this device has data,
// push it up, then park the key so the import never repeats.
export async function importLegacyLocalStorage(server: Data): Promise<boolean> {
  if (IS_DEMO) return false;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return false;
  if (server.rooms.length + server.places.length + server.items.length > 0) return false;
  let parsed: Data;
  try {
    parsed = JSON.parse(raw) as Data;
  } catch {
    return false;
  }
  if (!Array.isArray(parsed.rooms) || !Array.isArray(parsed.places) || !Array.isArray(parsed.items)) {
    return false;
  }
  await request<Data>("POST", "/import", parsed);
  localStorage.setItem(`${LEGACY_KEY}-imported`, raw);
  localStorage.removeItem(LEGACY_KEY);
  return true;
}

// Client-side JSON export — a backup valve independent of the server.
export function exportData(data: Data): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `homestead-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
