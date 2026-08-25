import { expect, test } from "vitest";
import { placeTableRows, type PlaceTableQuery } from "./placeTable";
import type { Data } from "./domain";

const data: Data = {
  rooms: [
    { id: "office", name: "Office", travel: "NEAR" },
    { id: "basement", name: "Basement", travel: "FAR" },
  ],
  places: [
    { id: "shelf", roomId: "office", name: "Open shelf", cue: "OPEN", capacity: 6 },
    { id: "tray", roomId: "office", name: "Desk tray", cue: "CUE", capacity: 1 },
    { id: "bins", roomId: "basement", name: "Labeled bins", cue: "HIDDEN", capacity: 10 },
  ],
  items: [
    { id: "a", name: "A", lifecycle: "FIXED", placement: "NEAR_CUE", home: "tray", location: "tray" },
    { id: "b", name: "B", lifecycle: "FIXED", placement: "NEAR_CUE", home: "tray", location: "tray" },
    { id: "c", name: "C", lifecycle: "FIXED", placement: "FAR_HIDDEN", home: "bins", location: "bins" },
  ],
};

const q = (over?: Partial<PlaceTableQuery>): PlaceTableQuery => ({
  sort: "place",
  dir: "asc",
  room: "",
  cue: "",
  placement: "",
  query: "",
  ...over,
});

test("default sort is by place name ascending", () => {
  expect(placeTableRows(data, q()).map((r) => r.place.id)).toEqual(["tray", "bins", "shelf"]);
});

test("sort direction flips the order", () => {
  expect(placeTableRows(data, q({ dir: "desc" })).map((r) => r.place.id)).toEqual([
    "shelf",
    "bins",
    "tray",
  ]);
});

test("sorting by room uses the room name", () => {
  const rows = placeTableRows(data, q({ sort: "room" }));
  expect(rows.map((r) => r.roomName)).toEqual(["Basement", "Office", "Office"]);
});

test("sorting by occupancy uses fullness ratio, so over-capacity tops descending", () => {
  const rows = placeTableRows(data, q({ sort: "occupancy", dir: "desc" }));
  expect(rows[0].place.id).toBe("tray"); // 2/1 = 200%
  expect(rows[1].place.id).toBe("bins"); // 1/10
  expect(rows[2].place.id).toBe("shelf"); // 0/6
});

test("rows carry derived placement and occupancy", () => {
  const tray = placeTableRows(data, q()).find((r) => r.place.id === "tray")!;
  expect(tray.placement).toBe("NEAR_CUE");
  expect(tray.count).toBe(2);
  expect(tray.over).toBe(true);
});

test("room, cue, and placement filters combine", () => {
  expect(placeTableRows(data, q({ room: "office" })).map((r) => r.place.id)).toEqual([
    "tray",
    "shelf",
  ]);
  expect(placeTableRows(data, q({ cue: "HIDDEN" })).map((r) => r.place.id)).toEqual(["bins"]);
  expect(placeTableRows(data, q({ placement: "NEAR_OPEN" })).map((r) => r.place.id)).toEqual([
    "shelf",
  ]);
  expect(placeTableRows(data, q({ room: "office", cue: "HIDDEN" }))).toEqual([]);
});

test("text query matches place, room, and notes, case-insensitively", () => {
  expect(placeTableRows(data, q({ query: "BASE" })).map((r) => r.place.id)).toEqual(["bins"]);
  expect(placeTableRows(data, q({ query: "desk" })).map((r) => r.place.id)).toEqual(["tray"]);
});
