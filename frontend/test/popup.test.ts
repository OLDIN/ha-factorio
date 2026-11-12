import { describe, expect, it } from "vitest";
import { POPUP_MARGIN, placePopup } from "../src/map/popup";

const AREA = { width: 1200, height: 640 };
const SIZE = { width: 340, height: 180 };

const inside = (p: ReturnType<typeof placePopup>, area = AREA): boolean =>
  p.x >= POPUP_MARGIN - 1e-6 &&
  p.y >= POPUP_MARGIN - 1e-6 &&
  p.x + p.width <= area.width - POPUP_MARGIN + 1e-6 &&
  p.y + p.height <= area.height - POPUP_MARGIN + 1e-6;

describe("placePopup", () => {
  it("goes to the right of the body with a lead from its edge", () => {
    const body = { cx: 300, cy: 300, r: 18 };
    const p = placePopup(body, AREA, SIZE);
    expect(p.x).toBeGreaterThan(body.cx + body.r);
    expect(inside(p)).toBe(true);
    expect(Math.hypot(p.line!.x1 - body.cx, p.line!.y1 - body.cy)).toBeCloseTo(body.r, 5);
    expect(p.line!.x2).toBeCloseTo(p.x, 5); // the near edge of the popup
  });

  it("flips to the left near the right edge", () => {
    const p = placePopup({ cx: 1100, cy: 300, r: 18 }, AREA, SIZE);
    expect(p.x + p.width).toBeLessThan(1100 - 18);
    expect(inside(p)).toBe(true);
  });

  it("goes below or above when neither side has room", () => {
    const narrow = { width: 420, height: 640 };
    const below = placePopup({ cx: 210, cy: 100, r: 18 }, narrow, SIZE);
    expect(below.y).toBeGreaterThan(100 + 18);
    expect(inside(below, narrow)).toBe(true);
    const above = placePopup({ cx: 210, cy: 560, r: 18 }, narrow, SIZE);
    expect(above.y + above.height).toBeLessThan(560 - 18);
    expect(inside(above, narrow)).toBe(true);
  });

  it("stays inside the map near the top and bottom edges", () => {
    for (const cy of [0, 10, 320, 630, 640]) expect(inside(placePopup({ cx: 300, cy, r: 18 }, AREA, SIZE))).toBe(true);
  });

  it("shrinks a popup taller than the map", () => {
    const p = placePopup({ cx: 300, cy: 300, r: 18 }, AREA, { width: 340, height: 2000 });
    expect(p.height).toBe(AREA.height - 2 * POPUP_MARGIN);
    expect(inside(p)).toBe(true);
  });

  it("is always inside the map, wherever the body is", () => {
    for (let cx = 0; cx <= 1200; cx += 75) for (let cy = 0; cy <= 640; cy += 40) expect(inside(placePopup({ cx, cy, r: 18 }, AREA, SIZE))).toBe(true);
  });
});
