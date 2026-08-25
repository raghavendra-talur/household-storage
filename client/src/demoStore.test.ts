import { beforeEach, expect, test } from "vitest";
import * as demo from "./demoStore";

beforeEach(() => demo.resetForTests());

test("starts with a seeded sample house", async () => {
  const s = await demo.fetchState();
  expect(s.rooms.length).toBeGreaterThan(2);
  expect(s.places.length).toBeGreaterThan(2);
  expect(s.items.length).toBeGreaterThan(2);
});

test("create room validates and assigns an id", async () => {
  const room = await demo.createRoom({ name: "Attic", travel: "FAR", notes: "" });
  expect(room.id).toBeTruthy();
  const s = await demo.fetchState();
  expect(s.rooms.some((r) => r.id === room.id)).toBe(true);
  await expect(demo.createRoom({ name: "", travel: "FAR", notes: "" })).rejects.toThrow(/name/);
});

test("state returns copies — mutating the result does not corrupt the store", async () => {
  const s1 = await demo.fetchState();
  s1.rooms.pop();
  s1.items[0].name = "vandalized";
  const s2 = await demo.fetchState();
  expect(s2.rooms.length).toBeGreaterThan(s1.rooms.length);
  expect(s2.items[0].name).not.toBe("vandalized");
});

test("item creation defaults location to home, or UNKNOWN when homeless", async () => {
  const s = await demo.fetchState();
  const place = s.places[0];
  const homed = await demo.createItem({
    name: "Homed thing",
    lifecycle: "FIXED",
    placement: "NEAR_OPEN",
    home: place.id,
    location: "",
  });
  expect(homed.location).toBe(place.id);
  const stray = await demo.createItem({
    name: "Stray thing",
    lifecycle: "MOBILE",
    placement: "NEAR_OPEN",
    home: null,
    location: "",
  });
  expect(stray.location).toBe("UNKNOWN");
});

test("updating an item can re-home and move it; unknown refs are rejected", async () => {
  const s = await demo.fetchState();
  const item = s.items[0];
  const other = s.places.find((p) => p.id !== item.home)!;
  const updated = await demo.updateItem(item.id, { home: other.id, location: "IN_USE" });
  expect(updated.home).toBe(other.id);
  expect(updated.location).toBe("IN_USE");
  await expect(demo.updateItem(item.id, { home: "nope" })).rejects.toThrow(/does not exist/);
});

test("deleting a place orphans homed items and marks located items unknown", async () => {
  const s = await demo.fetchState();
  const place = s.places[0];
  const item = await demo.createItem({
    name: "Occupant",
    lifecycle: "FIXED",
    placement: "NEAR_OPEN",
    home: place.id,
    location: place.id,
  });
  await demo.deletePlace(place.id);
  const after = await demo.fetchState();
  const got = after.items.find((i) => i.id === item.id)!;
  expect(got.home).toBeNull();
  expect(got.location).toBe("UNKNOWN");
});

test("deleting a room is refused while it still has places", async () => {
  const s = await demo.fetchState();
  const roomWithPlaces = s.rooms.find((r) => s.places.some((p) => p.roomId === r.id))!;
  await expect(demo.deleteRoom(roomWithPlaces.id)).rejects.toThrow(/places/);
  const empty = await demo.createRoom({ name: "Empty room", travel: "NEAR", notes: "" });
  await expect(demo.deleteRoom(empty.id)).resolves.toBeUndefined();
});
