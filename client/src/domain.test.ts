import { describe, expect, test } from "vitest";
import {
  allowed,
  designIssues,
  greeting,
  misplacedItems,
  overloadedPlaces,
  placementOf,
  pretty,
  unknownItems,
  type Data,
  type Item,
} from "./domain";

const room = (id: string, travel: "NEAR" | "FAR") => ({ id, name: id, travel });
const place = (id: string, roomId: string, cue: "CUE" | "OPEN" | "HIDDEN", capacity = 5) => ({
  id,
  roomId,
  name: id,
  cue,
  capacity,
});
const item = (overrides: Partial<Item> & Pick<Item, "id" | "lifecycle" | "placement">): Item => ({
  name: overrides.id,
  home: null,
  location: "UNKNOWN",
  ...overrides,
});

const data: Data = {
  rooms: [room("office", "NEAR"), room("basement", "FAR")],
  places: [
    place("shelf", "office", "OPEN"),
    place("tray", "office", "CUE", 1),
    place("bins", "basement", "HIDDEN"),
  ],
  items: [],
};

test("pretty humanizes enum values", () => {
  expect(pretty("NEAR_HIDDEN")).toBe("Near Hidden");
  expect(pretty("FIXED")).toBe("Fixed");
});

test("placementOf combines room travel with place cue", () => {
  expect(placementOf(data, "shelf")).toBe("NEAR_OPEN");
  expect(placementOf(data, "bins")).toBe("FAR_HIDDEN");
});

test("archive items may only live far and hidden", () => {
  expect(allowed.ARCHIVE).toEqual(["FAR_HIDDEN"]);
});

describe("designIssues", () => {
  test("flags a home whose placement does not match the item's requirement", () => {
    const d = { ...data, items: [item({ id: "taxes", lifecycle: "ARCHIVE", placement: "FAR_HIDDEN", home: "shelf", location: "shelf" })] };
    const issues = designIssues(d);
    expect(issues.some((i) => i.severity === "error" && i.text.includes("Needs Far Hidden"))).toBe(true);
  });

  test("flags illegal lifecycle/placement combinations", () => {
    const d = { ...data, items: [item({ id: "taxes", lifecycle: "ARCHIVE", placement: "NEAR_OPEN", home: "shelf", location: "shelf" })] };
    expect(designIssues(d).some((i) => i.severity === "error" && i.text.includes("cannot use"))).toBe(true);
  });

  test("flags mobile items without a home", () => {
    const d = { ...data, items: [item({ id: "keys", lifecycle: "MOBILE", placement: "NEAR_CUE" })] };
    expect(designIssues(d).some((i) => i.severity === "error" && i.text.includes("no home"))).toBe(true);
  });

  test("lints far-away mobile items instead of erroring", () => {
    const d = { ...data, items: [item({ id: "tool", lifecycle: "MOBILE", placement: "FAR_HIDDEN", home: "bins", location: "bins" })] };
    const issues = designIssues(d).filter((i) => i.item.id === "tool");
    expect(issues.some((i) => i.severity === "lint")).toBe(true);
    expect(issues.some((i) => i.severity === "error")).toBe(false);
  });

  test("a well-placed item raises nothing", () => {
    const d = { ...data, items: [item({ id: "yoga", lifecycle: "FIXED", placement: "NEAR_OPEN", home: "shelf", location: "shelf" })] };
    expect(designIssues(d)).toEqual([]);
  });
});

test("misplaced excludes items in use or lost", () => {
  const d = {
    ...data,
    items: [
      item({ id: "a", lifecycle: "MOBILE", placement: "NEAR_OPEN", home: "shelf", location: "tray" }),
      item({ id: "b", lifecycle: "MOBILE", placement: "NEAR_OPEN", home: "shelf", location: "IN_USE" }),
      item({ id: "c", lifecycle: "MOBILE", placement: "NEAR_OPEN", home: "shelf", location: "UNKNOWN" }),
      item({ id: "d", lifecycle: "MOBILE", placement: "NEAR_OPEN", home: "shelf", location: "shelf" }),
    ],
  };
  expect(misplacedItems(d).map((i) => i.id)).toEqual(["a"]);
  expect(unknownItems(d).map((i) => i.id)).toEqual(["c"]);
});

test("overloaded places exceed their capacity by physical occupancy", () => {
  const d = {
    ...data,
    items: [
      item({ id: "a", lifecycle: "FIXED", placement: "NEAR_CUE", home: "tray", location: "tray" }),
      item({ id: "b", lifecycle: "FIXED", placement: "NEAR_CUE", home: "tray", location: "tray" }),
    ],
  };
  expect(overloadedPlaces(d).map((p) => p.id)).toEqual(["tray"]);
});

test("greeting follows the clock", () => {
  expect(greeting(6)).toBe("Good morning");
  expect(greeting(13)).toBe("Good afternoon");
  expect(greeting(19)).toBe("Good evening");
  expect(greeting(23)).toBe("Good night");
});
