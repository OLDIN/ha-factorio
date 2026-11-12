import { describe, expect, it } from "vitest";
import bodies5 from "./fixtures/bodies-5.json";
import bodies21 from "./fixtures/bodies-21.json";
import { generateBodies } from "./fixtures/generate";
import { layoutBodies, type Body, type Placed } from "../src/map/layout";

const SIZE = { width: 1360, height: 640 };
const SETS: Record<string, Body[]> = {
  "5": bodies5 as Body[],
  "21": bodies21 as Body[],
  "60": generateBodies(60, 42),
};

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The brief's rule: a label is about `characters × 7.5` px wide at 13 px (moons use 11 px). */
function labelBox(p: Placed): Box {
  const font = p.parent === null ? 13 : 11;
  const width = p.name.length * 7.5 * (font / 13);
  const x0 = p.label.anchor === "start" ? p.label.x : p.label.anchor === "end" ? p.label.x - width : p.label.x - width / 2;
  return { x0, x1: x0 + width, y0: p.label.y - font, y1: p.label.y + font * 0.25 };
}

const boxesOverlap = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function boxHitsCircle(box: Box, p: Placed): boolean {
  const nx = Math.min(Math.max(p.cx, box.x0), box.x1);
  const ny = Math.min(Math.max(p.cy, box.y0), box.y1);
  return Math.hypot(nx - p.cx, ny - p.cy) < p.r;
}

function labelProblems(placed: Placed[]): number {
  const boxes = placed.map(labelBox);
  let problems = 0;
  boxes.forEach((box, i) => {
    if (box.x0 < 0 || box.y0 < 0 || box.x1 > SIZE.width || box.y1 > SIZE.height) problems++;
    for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(box, boxes[j])) problems++;
    for (const p of placed) if (boxHitsCircle(box, p)) problems++;
  });
  return problems;
}

describe.each(Object.keys(SETS))("layoutBodies with %s bodies", (key) => {
  const bodies = SETS[key];
  const placed = layoutBodies(bodies, SIZE);
  const byName = new Map(placed.map((p) => [p.name, p]));

  it("places every body once, inside the card", () => {
    expect(placed).toHaveLength(bodies.length);
    expect(new Set(placed.map((p) => p.name)).size).toBe(bodies.length);
    for (const p of placed) {
      expect(Number.isFinite(p.cx) && Number.isFinite(p.cy) && Number.isFinite(p.r)).toBe(true);
      expect(p.cx - p.r).toBeGreaterThanOrEqual(0);
      expect(p.cy - p.r).toBeGreaterThanOrEqual(0);
      expect(p.cx + p.r).toBeLessThanOrEqual(SIZE.width);
      expect(p.cy + p.r).toBeLessThanOrEqual(SIZE.height);
    }
  });

  it("circles do not overlap (centres at least r1 + r2 + 4 apart)", () => {
    const bad: string[] = [];
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r + 4 - 1e-6) bad.push(`${a.name}/${b.name}`);
      }
    expect(bad).toEqual([]);
  });

  it("x of top-level bodies grows with distance", () => {
    const top = bodies.filter((b) => !b.parent || !byName.has(b.parent));
    for (const a of top)
      for (const b of top) {
        const pa = byName.get(a.name)!;
        const pb = byName.get(b.name)!;
        if (a.distance! < b.distance!) expect(pa.cx).toBeLessThan(pb.cx);
        if (a.distance === b.distance) expect(pa.cx).toBeCloseTo(pb.cx, 6);
      }
  });

  it("moons stay within 40 px of their parent", () => {
    const moons = placed.filter((p) => p.parent !== null);
    if (key !== "5") expect(moons.length).toBeGreaterThan(0);
    for (const m of moons) {
      const parent = byName.get(m.parent!)!;
      expect(Math.hypot(m.cx - parent.cx, m.cy - parent.cy)).toBeLessThanOrEqual(40);
    }
  });

  it("labels do not overlap each other or circles", () => {
    expect(labelProblems(placed)).toBeLessThanOrEqual(key === "60" ? 3 : 0);
  });
});

describe("layoutBodies edge cases", () => {
  it("handles no bodies, one body and equal distances", () => {
    expect(layoutBodies([], SIZE)).toEqual([]);
    const one = layoutBodies([{ name: "solo", distance: 10, orientation: 0.3, state: "built" }], SIZE);
    expect(one).toHaveLength(1);
    expect(Number.isFinite(one[0].cx) && Number.isFinite(one[0].cy)).toBe(true);
    const same = layoutBodies(
      [
        { name: "a", distance: 10, orientation: 0.2, state: "built" },
        { name: "b", distance: 10, orientation: 0.2, state: "built" },
      ],
      SIZE,
    );
    expect(same[0].cx).toBe(same[1].cx);
    expect(Math.abs(same[0].cy - same[1].cy)).toBeGreaterThanOrEqual(same[0].r + same[1].r + 4);
  });

  it("treats absent fields as null and orphan moons as top-level", () => {
    const placed = layoutBodies(
      [
        { name: "a", x: 3, y: -4 },
        { name: "b", distance: 20, orientation: 0.5, state: "locked" },
        { name: "orphan", distance: 1, orientation: 0.1, parent: "missing", state: "unlocked" },
      ],
      SIZE,
    );
    const orphan = placed.find((p) => p.name === "orphan")!;
    expect(orphan.parent).toBeNull();
    for (const p of placed) expect(Number.isFinite(p.cx) && Number.isFinite(p.cy)).toBe(true);
  });

  it("sizes bodies by state and magnitude", () => {
    const placed = layoutBodies(
      [
        { name: "big", distance: 1, orientation: 0, magnitude: 5, state: "built" },
        { name: "small", distance: 2, orientation: 0, magnitude: 0, state: "built" },
        { name: "open", distance: 3, orientation: 0, state: "unlocked" },
        { name: "closed", distance: 4, orientation: 0, state: "locked" },
      ],
      SIZE,
    );
    expect(placed.map((p) => p.r)).toEqual([22, 12, 9, 8]);
  });
});
