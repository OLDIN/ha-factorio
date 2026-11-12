import { describe, expect, it } from "vitest";
import bodies21 from "./fixtures/bodies-21.json";
import { generateBodies } from "./fixtures/generate";
import { labelRect, layoutBodies, type Body, type Placed } from "../src/map/layout";
import { collectAlerts, placeCallouts, type Callout, type CalloutInput } from "../src/map/callouts";
import type { HassState } from "../src/shared/types";

const SIZE = { width: 1360, height: 640 };
const BODIES = bodies21 as Body[];
const PLACED = layoutBodies(BODIES, SIZE);
const NOW = Date.parse("2026-11-12T12:00:00Z");

function attackInput(body: string): CalloutInput {
  return {
    body,
    tone: "attack",
    title: `Attack on ${body}: 2 min`,
    lines: [
      { text: "Lost: Gun turret ×4, Stone wall ×12", tone: "text" },
      { text: "near [-412, 1180]", tone: "muted" },
      { text: "3 turrets out of ammo", tone: "amber" },
    ],
  };
}
function warningInput(body: string): CalloutInput {
  return { body, tone: "warning", title: `${body}: defense`, lines: [{ text: "6 turrets out of ammo", tone: "text" }] };
}

const LEAD_GAP = 3;

/** The segment passes through the rectangle (1 px inside its edges). */
function segmentHitsRect(line: Callout["line"], r: { x0: number; x1: number; y0: number; y1: number }): boolean {
  for (let i = 0; i <= 100; i++) {
    const x = line.x1 + ((line.x2 - line.x1) * i) / 100;
    const y = line.y1 + ((line.y2 - line.y1) * i) / 100;
    if (x > r.x0 + 1 && x < r.x1 - 1 && y > r.y0 + 1 && y < r.y1 - 1) return true;
  }
  return false;
}

const overlap = (a: Callout, b: Callout): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function circleHitsBox(p: Placed, c: Callout): boolean {
  const nx = Math.min(Math.max(p.cx, c.x), c.x + c.width);
  const ny = Math.min(Math.max(p.cy, c.y), c.y + c.height);
  return Math.hypot(nx - p.cx, ny - p.cy) < p.r;
}

function checkPlacement(callouts: Callout[], placed: Placed[]): void {
  const byName = new Map(placed.map((p) => [p.name, p]));
  for (let i = 0; i < callouts.length; i++)
    for (let j = i + 1; j < callouts.length; j++)
      expect(overlap(callouts[i], callouts[j]), `${callouts[i].body} / ${callouts[j].body}`).toBe(false);
  for (const c of callouts) {
    const body = byName.get(c.body)!;
    // The line starts on the edge of its own body (tolerance 0.5 px), or right past the body's own
    // label when the label is in its way, and never runs through that label.
    const d = Math.hypot(c.line.x1 - body.cx, c.line.y1 - body.cy);
    const own = labelRect(body);
    const pastLabel = c.line.x1 === body.cx && (Math.abs(c.line.y1 - own.y1 - LEAD_GAP) <= 0.5 || Math.abs(c.line.y1 - own.y0 + LEAD_GAP) <= 0.5);
    expect(Math.abs(d - body.r) <= 0.5 || pastLabel, c.body).toBe(true);
    // Crowded maps only: a label under a callout box is not seen (nor is a lead drawn under the box),
    // and a box level with its body gets the shortest lead whatever is next to it.
    const covered = callouts.some((o) => o.x < own.x1 && own.x0 < o.x + o.width && o.y < own.y1 && own.y0 < o.y + o.height);
    const level = c.y < body.cy && body.cy < c.y + c.height;
    if (!covered && !level) expect(segmentHitsRect(c.line, own), `${c.body} lead through its label`).toBe(false);
    // ...and ends on the callout box.
    expect(c.line.x2).toBeGreaterThanOrEqual(c.x - 0.5);
    expect(c.line.x2).toBeLessThanOrEqual(c.x + c.width + 0.5);
    expect([c.y, c.y + c.height].some((y) => Math.abs(c.line.y2 - y) <= 0.5)).toBe(true);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(SIZE.width);
  }
}

describe("placeCallouts", () => {
  it("places the dashboard scenario without overlaps, lines start on their bodies", () => {
    const items = [attackInput("nauvis"), warningInput("fulgora"), warningInput("corrundum")];
    const callouts = placeCallouts(items, PLACED, SIZE);
    expect(callouts.map((c) => c.body).sort()).toEqual(["corrundum", "fulgora", "nauvis"]);
    checkPlacement(callouts, PLACED);
    for (const c of callouts)
      for (const p of PLACED) {
        expect(circleHitsBox(p, c), `${c.body} covers ${p.name}`).toBe(false);
        const l = labelRect(p);
        const hit = c.x < l.x1 && l.x0 < c.x + c.width && c.y < l.y1 && l.y0 < c.y + c.height;
        expect(hit, `${c.body} covers the label of ${p.name}`).toBe(false);
      }
  });

  it("puts bodies of the upper half into the upper band and the rest into the lower one", () => {
    // Nothing in the way of the leads: the band is the one of the body's half.
    const placed: Placed[] = [200, 330, 150, 480, 310, 330].map((cy, i) => ({
      name: `b${i}`,
      cx: 100 + i * 220,
      cy,
      r: 15,
      label: { x: 100 + i * 220, y: cy + 35, anchor: "middle" as const },
      parent: null,
    }));
    const callouts = placeCallouts(placed.map((p) => warningInput(p.name)), placed, SIZE);
    expect(callouts).toHaveLength(placed.length);
    for (const c of callouts) {
      const body = placed.find((p) => p.name === c.body)!;
      expect(c.band, c.body).toBe(body.cy < SIZE.height / 2 ? "top" : "bottom");
      if (c.band === "top") expect(c.y + c.height).toBeLessThan(body.cy);
      else expect(c.y).toBeGreaterThan(body.cy);
    }
    checkPlacement(callouts, placed);
  });

  it("takes the other band when the lead would cross a body", () => {
    const placed: Placed[] = [
      { name: "inner", cx: 400, cy: 300, r: 18, label: { x: 440, y: 305, anchor: "start" }, parent: null },
      { name: "above", cx: 400, cy: 160, r: 9, label: { x: 420, y: 165, anchor: "start" }, parent: null },
    ];
    const [c] = placeCallouts([warningInput("inner")], placed, SIZE);
    expect(c.band).toBe("bottom");
    checkPlacement([c], placed);
  });

  it("stacks many callouts in rows without overlaps", () => {
    const callouts = placeCallouts(BODIES.map((b, i) => (i % 3 ? warningInput(b.name) : attackInput(b.name))), PLACED, SIZE);
    expect(callouts).toHaveLength(BODIES.length);
    checkPlacement(callouts, PLACED);
  });

  it("respects the band extents (header and legend areas)", () => {
    const placed = layoutBodies(generateBodies(60, 7), SIZE);
    const items = placed.slice(0, 12).map((p) => warningInput(p.name));
    const callouts = placeCallouts(items, placed, { ...SIZE, top: { x0: 380, x1: 1344 }, bottom: { x0: 16, x1: 990 } });
    checkPlacement(callouts, placed);
    for (const c of callouts) {
      const range = c.y + c.height < SIZE.height / 2 ? { x0: 380, x1: 1344 } : { x0: 16, x1: 990 };
      expect(c.x).toBeGreaterThanOrEqual(range.x0);
      expect(c.x + c.width).toBeLessThanOrEqual(range.x1);
    }
  });

  it("uses the other band when its own band's extent keeps the box far from the body", () => {
    const placed: Placed[] = [
      { name: "inner", cx: 120, cy: 300, r: 18, label: { x: 120, y: 340, anchor: "middle" }, parent: null },
      { name: "outer", cx: 900, cy: 300, r: 18, label: { x: 900, y: 340, anchor: "middle" }, parent: null },
    ];
    const area = { ...SIZE, top: { x0: 700, x1: 1344 }, bottom: { x0: 16, x1: 1000 } };
    const callouts = placeCallouts([warningInput("inner"), warningInput("outer")], placed, area);
    const band = (name: string): string | undefined => callouts.find((c) => c.body === name)?.band;
    expect(band("inner")).toBe("bottom"); // the summary blocks the upper band near it
    expect(band("outer")).toBe("top");
    checkPlacement(callouts, placed);
  });

  it("starts the lead past the body's own label below it", () => {
    const placed: Placed[] = [{ name: "home", cx: 400, cy: 400, r: 18, label: { x: 400, y: 436, anchor: "middle" }, parent: null }];
    const [c] = placeCallouts([attackInput("home")], placed, SIZE);
    expect(c.band).toBe("bottom");
    const l = labelRect(placed[0]);
    expect(c.line.x1).toBe(400);
    expect(c.line.y1).toBeCloseTo(l.y1 + LEAD_GAP, 5);
    checkPlacement([c], placed);
  });

  it("starts the lead past the body's own label above it", () => {
    const placed: Placed[] = [{ name: "home", cx: 400, cy: 220, r: 18, label: { x: 400, y: 194, anchor: "middle" }, parent: null }];
    const [c] = placeCallouts([warningInput("home")], placed, SIZE);
    expect(c.band).toBe("top");
    const l = labelRect(placed[0]);
    expect(c.line.y1).toBeCloseTo(l.y0 - LEAD_GAP, 5);
    checkPlacement([c], placed);
  });

  it("keeps the lead on the body edge when the label is to the side", () => {
    const placed: Placed[] = [{ name: "home", cx: 400, cy: 400, r: 18, label: { x: 426, y: 405, anchor: "start" }, parent: null }];
    const [c] = placeCallouts([warningInput("home")], placed, SIZE);
    expect(c.line.y1).toBeCloseTo(418, 5);
  });

  it("wraps long lines in a box of limited width instead of stretching it", () => {
    const losses = "Lost: Gun turret ×7, Medium electric pole ×7, Bulk inserter ×6, +11 more";
    const item: CalloutInput = {
      body: "nauvis",
      tone: "attack",
      title: "Attack on Nauvis: 4 min",
      lines: [
        { text: losses, tone: "text" },
        { text: "near [122, -259]", tone: "muted" },
      ],
    };
    const [c] = placeCallouts([item], PLACED, SIZE);
    expect(c.width).toBeLessThanOrEqual(360);
    expect(c.lines.length).toBe(3);
    expect(c.lines.slice(0, 2).map((l) => l.text).join(" ")).toBe(losses);
    expect(c.lines.slice(0, 2).every((l) => l.tone === "text")).toBe(true);
    expect(c.lines[2]).toEqual({ text: "near [122, -259]", tone: "muted" });
    expect(c.baselines).toHaveLength(c.lines.length + 1);
    expect(c.y + c.height).toBeGreaterThan(c.baselines[c.baselines.length - 1]);
  });

  it("leads past other bodies' labels when it can", () => {
    // The summary keeps the box right of x = 420; straight from the body, the lead would cut
    // through the label of "otherworld".
    const placed: Placed[] = [
      { name: "home", cx: 400, cy: 250, r: 18, label: { x: 400, y: 284, anchor: "middle" }, parent: null },
      { name: "otherworld", cx: 360, cy: 135, r: 9, label: { x: 375, y: 140, anchor: "start" }, parent: null },
    ];
    const [c] = placeCallouts([warningInput("home")], placed, { ...SIZE, top: { x0: 420, x1: 1344 } });
    expect(c.band).toBe("top");
    expect(segmentHitsRect(c.line, labelRect(placed[1]))).toBe(false);
    checkPlacement([c], placed);
  });

  it("never wraps a count away from its item", () => {
    const attack: HassState = {
      state: "on",
      last_changed: new Date(NOW - 4 * 60_000).toISOString(),
      // "Втрачено: Gun turret ×7, Medium electric pole ×7, …": the line is full right before the second "×7,".
      attributes: { losses: { "gun-turret": 7, "medium-electric-pole": 7, "bulk-inserter": 6, "rocket-turret": 4, "requester-chest": 2, substation: 1 } },
    };
    const alerts = collectAlerts({ "binary_sensor.factorio_main_gleba_under_attack": attack }, "main", BODIES, "uk", NOW);
    const [c] = placeCallouts(alerts, PLACED, SIZE);
    expect(c.lines.length).toBeGreaterThanOrEqual(2);
    for (const l of c.lines) expect(l.text.startsWith("×"), l.text).toBe(false);
  });

  it("ignores items for unknown bodies", () => {
    expect(placeCallouts([warningInput("nowhere")], PLACED, SIZE)).toEqual([]);
  });
});

function states(extra: Record<string, HassState>): Record<string, HassState> {
  return extra;
}

describe("collectAlerts", () => {
  const attack: HassState = {
    state: "on",
    last_changed: new Date(NOW - 2 * 60_000 - 5_000).toISOString(),
    attributes: { since_tick: 100, position: [-412, 1180], gps: "[gps=-412,1180,nauvis]", losses: { "gun-turret": 4, "stone-wall": 12, "small-electric-pole": 1, "medium-electric-pole": 1 } },
  };

  it("builds an attack callout with minutes, top losses and the planet's problems", () => {
    const alerts = collectAlerts(
      states({
        "binary_sensor.factorio_main_nauvis_under_attack": attack,
        "sensor.factorio_main_nauvis_turrets_no_ammo": { state: "3", attributes: { total: 120, no_power: 0, positions: [] } },
      }),
      "main",
      BODIES,
      "en",
      NOW,
    );
    expect(alerts).toHaveLength(1);
    const [a] = alerts;
    expect(a.body).toBe("nauvis");
    expect(a.tone).toBe("attack");
    expect(a.title).toBe("Attack on Nauvis: 2 min");
    const text = a.lines.map((l) => l.text).join(" | ");
    expect(text).toContain("Stone wall\u00a0×12");
    expect(text).toContain("Gun turret\u00a0×4");
    expect(text).toContain("+1");
    expect(text).toContain("-412, 1180");
    expect(a.lines.some((l) => l.tone === "amber" && l.text.includes("3"))).toBe(true);
  });

  it("builds warning callouts for turrets without ammo and damaged walls", () => {
    const alerts = collectAlerts(
      states({
        "sensor.factorio_main_fulgora_turrets_no_ammo": { state: "6", attributes: { total: 40, no_power: 0, positions: [] } },
        "sensor.factorio_main_corrundum_walls_damaged": { state: "12", attributes: { positions: [] } },
        "sensor.factorio_main_gleba_turrets_no_ammo": { state: "0", attributes: { total: 10, no_power: 0, positions: [] } },
        "binary_sensor.factorio_main_gleba_under_attack": { state: "off", attributes: {} },
      }),
      "main",
      BODIES,
      "uk",
      NOW,
    );
    expect(alerts.map((a) => [a.body, a.tone])).toEqual([
      ["fulgora", "warning"],
      ["corrundum", "warning"],
    ]);
    expect(alerts[0].lines[0].text).toContain("6");
    expect(alerts[1].lines[0].text).toContain("12");
    expect(alerts[0].title).toBe("Фульгора: оборона");
  });

  it("shows nothing when the entities are missing or unknown", () => {
    expect(collectAlerts({}, "main", BODIES, "en", NOW)).toEqual([]);
    expect(
      collectAlerts(
        states({ "sensor.factorio_main_fulgora_turrets_no_ammo": { state: "unknown", attributes: {} } }),
        "main",
        BODIES,
        "en",
        NOW,
      ),
    ).toEqual([]);
  });

  it("stops counting attack minutes while the game is paused", () => {
    const paused: HassState = { state: "paused", attributes: {}, last_changed: new Date(NOW - 60_000).toISOString() };
    const run = (lang: string, game?: HassState) =>
      collectAlerts(
        states({
          "binary_sensor.factorio_main_nauvis_under_attack": attack,
          ...(game ? { "sensor.factorio_main_game_state": game } : {}),
        }),
        "main",
        BODIES,
        lang,
        NOW,
      )[0].title;
    expect(run("uk", paused)).toBe("Наувіс: напад, гра на паузі");
    expect(run("en", paused)).toBe("Attack on Nauvis, game paused");
    expect(run("en", { ...paused, state: "no_connection" })).toBe("Attack on Nauvis, no connection");
    expect(run("en", { ...paused, state: "stopped" })).toBe("Attack on Nauvis, game stopped");
    expect(run("en", { ...paused, state: "running" })).toBe("Attack on Nauvis: 2 min");
    expect(run("en")).toBe("Attack on Nauvis: 2 min");
  });

  it("tolerates empty Lua tables and a missing last_changed", () => {
    const alerts = collectAlerts(
      states({ "binary_sensor.factorio_main_nauvis_under_attack": { state: "on", attributes: { losses: [], position: {} } } }),
      "main",
      BODIES,
      "en",
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("Nauvis");
  });
});
