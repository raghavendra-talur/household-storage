// View-model for the place-centric table: filtering, text search, and
// column sorting, all derived from the shared dataset.

import {
  occupancy,
  placementOf,
  roomById,
  type Cue,
  type Data,
  type Place,
  type Placement,
} from "./domain";

export type PlaceSortKey = "place" | "room" | "cue" | "placement" | "occupancy";

export interface PlaceTableQuery {
  sort: PlaceSortKey;
  dir: "asc" | "desc";
  room: string; // room id, or "" for all
  cue: Cue | "";
  placement: Placement | "";
  query: string; // free text over place name, room name, notes
}

export interface PlaceRow {
  place: Place;
  roomName: string;
  placement: Placement;
  count: number;
  over: boolean;
}

export function placeTableRows(data: Data, q: PlaceTableQuery): PlaceRow[] {
  const text = q.query.trim().toLowerCase();
  const rows = data.places
    .map((place): PlaceRow => {
      const count = occupancy(data, place.id);
      return {
        place,
        roomName: roomById(data, place.roomId)?.name ?? "Unknown",
        placement: placementOf(data, place.id),
        count,
        over: count > place.capacity,
      };
    })
    .filter((r) => {
      if (q.room && r.place.roomId !== q.room) return false;
      if (q.cue && r.place.cue !== q.cue) return false;
      if (q.placement && r.placement !== q.placement) return false;
      if (
        text &&
        ![r.place.name, r.roomName, r.place.notes ?? ""].some((s) =>
          s.toLowerCase().includes(text),
        )
      ) {
        return false;
      }
      return true;
    });

  const cmp = (a: PlaceRow, b: PlaceRow): number => {
    switch (q.sort) {
      case "room":
        return a.roomName.localeCompare(b.roomName) || a.place.name.localeCompare(b.place.name);
      case "cue":
        return a.place.cue.localeCompare(b.place.cue) || a.place.name.localeCompare(b.place.name);
      case "placement":
        return a.placement.localeCompare(b.placement) || a.place.name.localeCompare(b.place.name);
      case "occupancy":
        return (
          a.count / a.place.capacity - b.count / b.place.capacity ||
          a.place.name.localeCompare(b.place.name)
        );
      default:
        return a.place.name.localeCompare(b.place.name);
    }
  };
  rows.sort((a, b) => (q.dir === "asc" ? cmp(a, b) : -cmp(a, b)));
  return rows;
}
