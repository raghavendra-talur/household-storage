// The demo backend: the whole "server" as an in-memory object in the
// visitor's tab. Mirrors the Go store's semantics (validation, defaults,
// deletion side-effects) so the demo behaves like the real thing, but state
// lives only in this tab and vanishes when it closes. Nothing to host,
// nothing to hack.

import {
  lifecycles,
  placements,
  type Data,
  type Item,
  type Place,
  type Room,
} from "./domain";

const travels = ["NEAR", "FAR"];
const cues = ["CUE", "OPEN", "HIDDEN"];

function seed(): Data {
  return {
    rooms: [
      { id: "kitchen", name: "Kitchen", travel: "NEAR" },
      { id: "entry", name: "Entry", travel: "NEAR" },
      { id: "office", name: "Office", travel: "NEAR" },
      { id: "basement", name: "Basement", travel: "FAR", notes: "One flight down; a deliberate trip." },
      { id: "garage", name: "Garage", travel: "FAR" },
    ],
    places: [
      { id: "entry-drop", roomId: "entry", name: "Drop zone", cue: "CUE", capacity: 4 },
      { id: "kitchen-drawer", roomId: "kitchen", name: "Utility drawer", cue: "HIDDEN", capacity: 8 },
      { id: "office-shelf", roomId: "office", name: "Open shelf", cue: "OPEN", capacity: 6 },
      { id: "office-desk", roomId: "office", name: "Desk focus tray", cue: "CUE", capacity: 1 },
      { id: "basement-bins", roomId: "basement", name: "Labeled bins", cue: "HIDDEN", capacity: 10 },
      { id: "garage-bay", roomId: "garage", name: "Project bay", cue: "CUE", capacity: 4 },
    ],
    items: [
      { id: "keys", name: "House keys", lifecycle: "MOBILE", placement: "NEAR_CUE", home: "entry-drop", location: "entry-drop" },
      { id: "scissors", name: "Kitchen scissors", lifecycle: "MOBILE", placement: "NEAR_HIDDEN", home: "kitchen-drawer", location: "office-desk" },
      { id: "taxes", name: "2025 tax documents", lifecycle: "ARCHIVE", placement: "FAR_HIDDEN", home: "basement-bins", location: "basement-bins" },
      { id: "batteries", name: "AA batteries — pack 1", lifecycle: "SUPPLIES", placement: "FAR_HIDDEN", home: "basement-bins", location: "UNKNOWN" },
      { id: "lamp", name: "Desk lamp repair", lifecycle: "PROJECTS", placement: "NEAR_CUE", home: "office-desk", location: "IN_USE" },
      { id: "labelmaker", name: "Label maker", lifecycle: "MOBILE", placement: "NEAR_CUE", home: "office-desk", location: "office-desk" },
      { id: "donation", name: "Donation box", lifecycle: "OUTGOING", placement: "FAR_CUE", home: "garage-bay", location: "garage-bay" },
      { id: "yoga", name: "Yoga mat", lifecycle: "FIXED", placement: "NEAR_OPEN", home: "office-shelf", location: "office-shelf" },
    ],
  };
}

let data: Data = seed();

export function resetForTests(): void {
  data = seed();
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const newId = (): string => Math.random().toString(36).slice(2, 10);

function fail(message: string): never {
  throw new Error(message);
}

const placeExists = (id: string) => data.places.some((p) => p.id === id);

function validateRoom(room: Omit<Room, "id">): void {
  if (!room.name) fail("room name is required");
  if (!travels.includes(room.travel)) fail(`travel must be one of ${travels.join(", ")}`);
}

function validatePlace(place: Omit<Place, "id">): void {
  if (!place.name) fail("place name is required");
  if (!cues.includes(place.cue)) fail(`cue must be one of ${cues.join(", ")}`);
  if (place.capacity < 1) fail("capacity must be at least 1");
  if (!data.rooms.some((r) => r.id === place.roomId)) fail(`room "${place.roomId}" does not exist`);
}

function validateItem(item: Omit<Item, "id">): void {
  if (!item.name) fail("item name is required");
  if (!lifecycles.includes(item.lifecycle)) fail("invalid lifecycle");
  if (!placements.includes(item.placement)) fail("invalid placement");
  if (item.home !== null && !placeExists(item.home)) fail(`home place "${item.home}" does not exist`);
  if (item.location !== "IN_USE" && item.location !== "UNKNOWN" && !placeExists(item.location)) {
    fail(`location "${item.location}" does not exist`);
  }
}

export async function fetchState(): Promise<Data> {
  return clone(data);
}

export async function createRoom(room: Omit<Room, "id">): Promise<Room> {
  validateRoom(room);
  const created: Room = { ...clone(room), id: newId() };
  data.rooms.push(created);
  return clone(created);
}

export async function updateRoom(id: string, patch: Partial<Omit<Room, "id">>): Promise<Room> {
  const room = data.rooms.find((r) => r.id === id) ?? fail("room not found");
  const next = { ...room, ...patch };
  validateRoom(next);
  Object.assign(room, next);
  return clone(room);
}

export async function deleteRoom(id: string): Promise<void> {
  const count = data.places.filter((p) => p.roomId === id).length;
  if (count > 0) fail(`room still has ${count} places`);
  const before = data.rooms.length;
  data.rooms = data.rooms.filter((r) => r.id !== id);
  if (data.rooms.length === before) fail("room not found");
}

export async function createPlace(place: Omit<Place, "id">): Promise<Place> {
  validatePlace(place);
  const created: Place = { ...clone(place), id: newId() };
  data.places.push(created);
  return clone(created);
}

export async function updatePlace(id: string, patch: Partial<Omit<Place, "id">>): Promise<Place> {
  const place = data.places.find((p) => p.id === id) ?? fail("place not found");
  const next = { ...place, ...patch };
  validatePlace(next);
  Object.assign(place, next);
  return clone(place);
}

export async function deletePlace(id: string): Promise<void> {
  if (!placeExists(id)) fail("place not found");
  for (const item of data.items) {
    if (item.home === id) item.home = null;
    if (item.location === id) item.location = "UNKNOWN";
  }
  data.places = data.places.filter((p) => p.id !== id);
}

export async function createItem(item: Omit<Item, "id">): Promise<Item> {
  const draft = { ...clone(item) };
  if (!draft.location) draft.location = draft.home ?? "UNKNOWN";
  validateItem(draft);
  const created: Item = { ...draft, id: newId() };
  data.items.push(created);
  return clone(created);
}

export async function updateItem(id: string, patch: Partial<Omit<Item, "id">>): Promise<Item> {
  const item = data.items.find((i) => i.id === id) ?? fail("item not found");
  const next = { ...item, ...patch };
  validateItem(next);
  Object.assign(item, next);
  return clone(item);
}

export async function deleteItem(id: string): Promise<void> {
  const before = data.items.length;
  data.items = data.items.filter((i) => i.id !== id);
  if (data.items.length === before) fail("item not found");
}
