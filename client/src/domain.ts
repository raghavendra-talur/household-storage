// The organizing model, as pure data + functions. State checks (misplaced,
// unknown, overloaded) run against where things ARE; design checks run
// against how homes are ASSIGNED. The server owns storage and referential
// integrity; every rule here is derived client-side from the full dataset.

export type Travel = "NEAR" | "FAR";
export type Cue = "CUE" | "OPEN" | "HIDDEN";
export type Placement = `${Travel}_${Cue}`;
export type Lifecycle =
  | "FIXED"
  | "MOBILE"
  | "SUPPLIES"
  | "PROJECTS"
  | "ARCHIVE"
  | "INCOMING"
  | "OUTGOING";
export type Location = string | "IN_USE" | "UNKNOWN";

export interface Room {
  id: string;
  name: string;
  travel: Travel;
  notes?: string;
}

export interface Place {
  id: string;
  roomId: string;
  name: string;
  cue: Cue;
  capacity: number;
  notes?: string;
}

export interface Item {
  id: string;
  name: string;
  lifecycle: Lifecycle;
  placement: Placement;
  home: string | null;
  location: Location;
  notes?: string;
  updatedAt?: string;
}

export interface Data {
  rooms: Room[];
  places: Place[];
  items: Item[];
}

export const lifecycles: Lifecycle[] = [
  "FIXED",
  "MOBILE",
  "SUPPLIES",
  "PROJECTS",
  "ARCHIVE",
  "INCOMING",
  "OUTGOING",
];

export const placements: Placement[] = [
  "NEAR_CUE",
  "NEAR_OPEN",
  "NEAR_HIDDEN",
  "FAR_CUE",
  "FAR_OPEN",
  "FAR_HIDDEN",
];

// Which placements each lifecycle may legally use. Scarce cue space stays
// calm when only the right things are allowed into it.
export const allowed: Record<Lifecycle, Placement[]> = {
  FIXED: placements,
  MOBILE: placements,
  SUPPLIES: ["NEAR_HIDDEN", "FAR_HIDDEN"],
  PROJECTS: ["NEAR_CUE", "NEAR_OPEN", "FAR_CUE", "FAR_OPEN"],
  ARCHIVE: ["FAR_HIDDEN"],
  INCOMING: ["NEAR_CUE", "NEAR_OPEN"],
  OUTGOING: ["NEAR_CUE", "NEAR_OPEN", "FAR_CUE"],
};

export const pretty = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export const roomById = (data: Data, id: string): Room | undefined =>
  data.rooms.find((r) => r.id === id);

export const placeById = (data: Data, id: string): Place | undefined =>
  data.places.find((p) => p.id === id);

// A place's effective placement: its room's travel cost x its own visibility.
export function placementOf(data: Data, placeId: string): Placement {
  const place = placeById(data, placeId);
  const travel = place ? (roomById(data, place.roomId)?.travel ?? "NEAR") : "NEAR";
  return `${travel}_${place?.cue ?? "HIDDEN"}` as Placement;
}

// How many items are physically at this place right now.
export const occupancy = (data: Data, placeId: string): number =>
  data.items.filter((i) => i.location === placeId).length;

// "Room · Place" label for a place id; degrades gracefully for missing refs.
export function address(data: Data, placeId: string | null): string {
  if (!placeId) return "No home";
  const place = placeById(data, placeId);
  const room = place ? roomById(data, place.roomId) : undefined;
  return `${room?.name ?? "Unknown"} · ${place?.name ?? "Missing place"}`;
}

export const misplacedItems = (data: Data): Item[] =>
  data.items.filter(
    (i) => i.location !== i.home && i.location !== "IN_USE" && i.location !== "UNKNOWN",
  );

export const unknownItems = (data: Data): Item[] =>
  data.items.filter((i) => i.location === "UNKNOWN");

export const overloadedPlaces = (data: Data): Place[] =>
  data.places.filter((p) => occupancy(data, p.id) > p.capacity);

export interface DesignIssue {
  item: Item;
  severity: "error" | "lint";
  text: string;
}

export function designIssues(data: Data): DesignIssue[] {
  return data.items.flatMap((item) => {
    const issues: DesignIssue[] = [];
    const home = item.home ? placeById(data, item.home) : undefined;
    if (home && item.placement !== placementOf(data, home.id)) {
      issues.push({
        item,
        severity: "error",
        text: `Needs ${pretty(item.placement)}, but home supplies ${pretty(placementOf(data, home.id))}.`,
      });
    }
    if (home && !allowed[item.lifecycle].includes(item.placement)) {
      issues.push({
        item,
        severity: "error",
        text: `${pretty(item.lifecycle)} items cannot use ${pretty(item.placement)}.`,
      });
    }
    if (item.lifecycle === "MOBILE" && !item.home) {
      issues.push({ item, severity: "error", text: "Mobile item has no home to return to." });
    }
    if (
      (item.lifecycle === "MOBILE" && item.placement.startsWith("FAR")) ||
      (item.lifecycle === "FIXED" && item.placement === "FAR_HIDDEN")
    ) {
      issues.push({ item, severity: "lint", text: "Confirm this item is used in its far room." });
    }
    return issues;
  });
}

export const LIMBO_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Items honestly parked "In use" or "Unknown" — but for so long that the
// parking itself is probably a lie. The same linter spirit, applied to time.
export function limboItems(data: Data, nowMs: number): Item[] {
  return data.items.filter((i) => {
    if (i.location !== "IN_USE" && i.location !== "UNKNOWN") return false;
    if (!i.updatedAt) return false;
    const ts = Date.parse(i.updatedAt);
    return Number.isFinite(ts) && nowMs - ts > LIMBO_AFTER_MS;
  });
}

export function greeting(hour: number): string {
  if (hour < 5 || hour >= 22) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
