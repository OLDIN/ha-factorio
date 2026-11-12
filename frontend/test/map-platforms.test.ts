import { describe, expect, it } from "vitest";
import type { Placed } from "../src/map/layout";
import { PARKED_MAX, placePlatforms } from "../src/map/platforms";
import type { PlatformRow } from "../src/shared/platforms";

function body(name: string, cx: number, cy: number, r = 18): Placed {
  return { name, cx, cy, r, label: { x: cx, y: cy + r + 14, anchor: "middle" }, parent: null };
}

function row(index: number, fields: Partial<PlatformRow> = {}): PlatformRow {
  return { index, name: `P${index}`, kind: "parked", location: "nauvis", route: null, damage: null, lines: [], linesMore: 0, ...fields };
}

const PLACED = [body("nauvis", 100, 100), body("gleba", 300, 100), body("aquilo", 500, 400)];
const title = (r: PlatformRow): string => r.name;

describe("placePlatforms", () => {
  it("puts a flying platform on the line between its bodies at its progress, with a route between their edges", () => {
    const out = placePlatforms([row(1, { kind: "flying", location: null, route: { from: "nauvis", to: "gleba", progress: 0.5 } })], PLACED, title);
    expect(out.diamonds).toHaveLength(1);
    expect(out.diamonds[0].x).toBeCloseTo(200, 6);
    expect(out.diamonds[0].y).toBeCloseTo(100, 6);
    expect(out.diamonds[0].tone).toBe("cyan");
    expect(out.routes).toHaveLength(1);
    const r = out.routes[0];
    expect(r.x1).toBeGreaterThan(100 + 18);
    expect(r.x2).toBeLessThan(300 - 18);
    expect(r.y1).toBeCloseTo(100, 6);
  });

  it("draws nothing for a route with a body that is not on the map", () => {
    const out = placePlatforms([row(1, { kind: "flying", location: null, route: { from: "vulcanus", to: "gleba", progress: 0.5 } })], PLACED, title);
    expect(out.diamonds).toEqual([]);
    expect(out.routes).toEqual([]);
  });

  it(`stacks at most ${PARKED_MAX} standing platforms next to a body, then "+N"`, () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(i + 1));
    const out = placePlatforms(rows, PLACED, title);
    expect(out.diamonds).toHaveLength(PARKED_MAX);
    expect(out.more).toEqual([expect.objectContaining({ count: 2 })]);
    const nauvis = PLACED[0];
    for (const d of out.diamonds) expect(Math.hypot(d.x - nauvis.cx, d.y - nauvis.cy)).toBeGreaterThanOrEqual(nauvis.r + 6);
    // distinct spots
    expect(new Set(out.diamonds.map((d) => `${Math.round(d.x)},${Math.round(d.y)}`)).size).toBe(PARKED_MAX);
  });

  it("damaged and problem platforms are amber and come first in the stack", () => {
    const rows = [row(1), row(2), row(3), row(4), row(5, { damage: { active: true, losses: {} } })];
    const out = placePlatforms(rows, PLACED, title);
    expect(out.diamonds[0].index).toBe(5);
    expect(out.diamonds[0].tone).toBe("amber");
    expect(out.diamonds.slice(1).every((d) => d.tone === "muted")).toBe(true);
  });

  it("skips a standing platform whose body is not on the map", () => {
    expect(placePlatforms([row(1, { location: "vulcanus" })], PLACED, title).diamonds).toEqual([]);
  });
});
