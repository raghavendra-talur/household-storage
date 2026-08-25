import { expect, test } from "vitest";
import { parseCaptureLines } from "./capture";

test("splits lines, trims whitespace, drops blanks", () => {
  expect(parseCaptureLines("old router\n  phone chargers (box)  \n\n\nikea allen keys\n")).toEqual([
    "old router",
    "phone chargers (box)",
    "ikea allen keys",
  ]);
});

test("single name without newline passes through", () => {
  expect(parseCaptureLines("broken lamp")).toEqual(["broken lamp"]);
});

test("drops duplicate lines within one paste, case-insensitively, keeping the first", () => {
  expect(parseCaptureLines("HDMI cable\nhdmi cable\nHDMI Cable\nusb hub")).toEqual([
    "HDMI cable",
    "usb hub",
  ]);
});

test("empty or whitespace-only input yields nothing", () => {
  expect(parseCaptureLines("")).toEqual([]);
  expect(parseCaptureLines("   \n \n")).toEqual([]);
});
