import { describe, expect, it } from "vitest";
import bodies21 from "./fixtures/bodies-21.json";
import type { Body } from "../src/map/layout";
import { collectAlerts, collectStatus, popupText, type Popup } from "../src/map/popups";
import type { HassState } from "../src/shared/types";

const BODIES = bodies21 as Body[];
const NOW = Date.parse("2026-11-12T12:00:00Z");

function states(extra: Record<string, HassState>): Record<string, HassState> {
  return extra;
}

/** The table as "label: value" pairs (several values joined with " / "). */
const table = (p: Popup): string[] => p.facts.map((f) => `${f.label}: ${Array.isArray(f.value) ? f.value.join(" / ") : f.value}`);
const bad = (p: Popup): string[] => p.facts.filter((f) => f.bad).map((f) => f.label);

describe("collectAlerts", () => {
  const attack: HassState = {
    state: "on",
    last_changed: new Date(NOW - 2 * 60_000 - 5_000).toISOString(),
    attributes: { since_tick: 100, position: [-412, 1180], gps: "[gps=-412,1180,nauvis]", losses: { "gun-turret": 4, "stone-wall": 12, "small-electric-pole": 1, "medium-electric-pole": 1 } },
  };

  it("builds an attack popup: minutes in the chip, top losses, where, the planet's problems, and the checks that passed", () => {
    const alerts = collectAlerts(
      states({
        "binary_sensor.factorio_main_nauvis_under_attack": attack,
        "sensor.factorio_main_nauvis_turrets_no_ammo": { state: "3", attributes: { total: 120, no_power: 0, positions: [] } },
        "sensor.factorio_main_nauvis_walls_damaged": { state: "0", attributes: {} },
      }),
      "main",
      BODIES,
      "en",
      NOW,
      new Map([["nauvis", { total: 300, working: 290, ok: 280 }]]),
    );
    expect(alerts).toHaveLength(1);
    const [a] = alerts;
    expect(a.body).toBe("nauvis");
    expect(a.tone).toBe("attack");
    expect(a.title).toBe("Nauvis");
    expect(a.chip).toBe("Attack · 2 min");
    expect(table(a)).toEqual([
      "Machines: 280 of 300",
      "Lost: Stone wall\u00a0×12 / Gun turret\u00a0×4 / Medium electric pole\u00a0×1 / +1 more",
      "Near: [-412, 1180]",
      "Turrets without ammo: 3",
    ]);
    expect(bad(a)).toEqual(["Turrets without ammo"]);
    expect(a.facts[0].bar).toEqual({ percent: (280 / 300) * 100, style: "solid" });
    expect(a.checks).toEqual(["Walls intact"]); // ammo is out, walls are fine; no drills or lines sensor
  });

  it("builds a defense popup for turrets without ammo and power and damaged walls", () => {
    const alerts = collectAlerts(
      states({
        "sensor.factorio_main_fulgora_turrets_no_ammo": { state: "6", attributes: { total: 40, no_power: 2, positions: [] } },
        "sensor.factorio_main_corrundum_walls_damaged": { state: "12", attributes: { positions: [] } },
        "sensor.factorio_main_gleba_turrets_no_ammo": { state: "0", attributes: { total: 10, no_power: 0, positions: [] } },
        "binary_sensor.factorio_main_gleba_under_attack": { state: "off", attributes: {} },
      }),
      "main",
      BODIES,
      "uk",
      NOW,
    );
    expect(alerts.map((a) => [a.body, a.tone, a.chip])).toEqual([
      ["fulgora", "warning", "Оборона"],
      ["corrundum", "warning", "Оборона"],
    ]);
    expect(table(alerts[0])).toEqual(["Турелі без набоїв: 6", "Турелі без енергії: 2"]);
    expect(table(alerts[1])).toEqual(["Пошкоджені стіни: 12"]);
    expect(alerts[0].title).toBe("Фульгора");
  });

  const lineSensor = (lines: unknown[]): HassState => ({ state: String(lines.length), attributes: { lines } });
  const scrap = { recipe: "scrap-recycling", reason: "output_full", stopped: 31, total: 48, minutes: 11 };
  const smelt = { recipe: "iron-plate", reason: "no_input", stopped: 20, total: 60, minutes: 3 };

  it("builds a line popup for a planet with one problem line: the line and its reason under it", () => {
    const alerts = collectAlerts(states({ "sensor.factorio_main_vulcanus_problem_lines": lineSensor([scrap]) }), "main", BODIES, "uk", NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toBe("vulcanus");
    expect(alerts[0].tone).toBe("warning");
    expect(alerts[0].title).toBe("Вулканус");
    expect(alerts[0].chip).toBe("Лінія стоїть");
    expect(alerts[0].facts).toEqual([{ label: "Scrap recycling", value: "31 з 48", note: "вихід забитий · 11 хв", bad: true }]);
  });

  it("counts the lines in the chip and adds depleted drills of the same planet", () => {
    const alerts = collectAlerts(
      states({
        "sensor.factorio_main_vulcanus_problem_lines": lineSensor([scrap, smelt]),
        "sensor.factorio_main_vulcanus_drills_depleted": { state: "3", attributes: { by_resource: { "iron-ore": { total: 12, depleted: 3 } } } },
      }),
      "main",
      BODIES,
      "en",
      NOW,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].chip).toBe("Lines stopped · 2");
    expect(table(alerts[0])).toEqual(["Scrap recycling: 31 of 48", "Iron plate: 20 of 60", "Iron ore, depleted drills: 3 of 12"]);
    expect(alerts[0].facts.map((f) => f.note)).toEqual(["output full · 11 min", "no input · 3 min", undefined]);
    expect(collectAlerts(states({ "sensor.factorio_main_vulcanus_problem_lines": lineSensor([scrap]) }), "main", BODIES, "en", NOW)[0].chip).toBe("Line stopped");
  });

  it("keeps the attack and defense chips and appends the production rows", () => {
    const alerts = collectAlerts(
      states({
        "binary_sensor.factorio_main_nauvis_under_attack": attack,
        "sensor.factorio_main_nauvis_problem_lines": lineSensor([scrap]),
        "sensor.factorio_main_fulgora_turrets_no_ammo": { state: "6", attributes: { total: 40, no_power: 0, positions: [] } },
        "sensor.factorio_main_fulgora_problem_lines": lineSensor([scrap]),
      }),
      "main",
      BODIES,
      "en",
      NOW,
    );
    const nauvis = alerts.find((a) => a.body === "nauvis")!;
    expect(nauvis.tone).toBe("attack");
    expect(nauvis.chip).toBe("Attack · 2 min");
    expect(table(nauvis).at(-1)).toBe("Scrap recycling: 31 of 48");
    const fulgora = alerts.find((a) => a.body === "fulgora")!;
    expect(fulgora.tone).toBe("warning");
    expect(fulgora.chip).toBe("Defense");
    expect(table(fulgora)).toEqual(["Turrets without ammo: 6", "Scrap recycling: 31 of 48"]);
  });

  it("stays quiet for depleted drills alone", () => {
    const alerts = collectAlerts(
      states({ "sensor.factorio_main_vulcanus_drills_depleted": { state: "3", attributes: { by_resource: { "iron-ore": { total: 12, depleted: 3 } } } } }),
      "main",
      BODIES,
      "en",
      NOW,
    );
    expect(alerts).toEqual([]);
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
      )[0].chip;
    expect(run("uk", paused)).toBe("Напад");
    expect(run("en", paused)).toBe("Attack");
    expect(run("en", { ...paused, state: "no_connection" })).toBe("Attack");
    expect(run("en", { ...paused, state: "stopped" })).toBe("Attack");
    expect(run("en", { ...paused, state: "running" })).toBe("Attack · 2 min");
    expect(run("en")).toBe("Attack · 2 min");
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
    expect(alerts[0].title).toBe("Nauvis");
    expect(alerts[0].chip).toBe("Attack");
    expect(alerts[0].facts).toEqual([]);
  });

  it("reads a popup as one sentence for the accessible summary", () => {
    const [a] = collectAlerts(states({ "sensor.factorio_main_corrundum_walls_damaged": { state: "12", attributes: {} } }), "main", BODIES, "en", NOW);
    expect(popupText(a)).toBe("Corrundum: Defense, Damaged walls: 12");
  });
});

describe("collectStatus", () => {
  const ctx = { alerting: new Set<string>(), research: new Map<string, number>(), machines: new Map(), platformsAt: new Map<string, number>() };
  const find = (st: Record<string, HassState>, name: string, extra = {}) =>
    collectStatus(st, "main", BODIES, "en", { ...ctx, ...extra }).find((p) => p.body === name);

  it("says all is well for a built planet whose sensors report nothing wrong", () => {
    const p = find(
      states({
        "sensor.factorio_main_vulcanus_evolution": { state: "12.4", attributes: {} },
        "sensor.factorio_main_vulcanus_turrets_no_ammo": { state: "0", attributes: { total: 40 } },
        "sensor.factorio_main_vulcanus_walls_damaged": { state: "0", attributes: {} },
        "sensor.factorio_main_vulcanus_drills_depleted": { state: "0", attributes: { by_resource: {} } },
        "sensor.factorio_main_vulcanus_problem_lines": { state: "0", attributes: { lines: [] } },
      }),
      "vulcanus",
      { machines: new Map([["vulcanus", { total: 80, working: 80, ok: 80 }]]), platformsAt: new Map([["vulcanus", 1]]) },
    )!;
    expect(p.tone).toBe("ok");
    expect(p.chip).toBe("All well");
    expect(table(p)).toEqual(["Machines: 80 of 80", "Enemy evolution: 12%", "Turrets: 40", "Platforms nearby: 1"]);
    expect(p.checks).toEqual(["Ammo in stock", "Walls intact", "Drills not depleted", "Lines fine"]);
  });

  it("does not say all is well while drills are depleted (they are no alert, but a row)", () => {
    const p = find(
      states({
        "sensor.factorio_main_vulcanus_evolution": { state: "12", attributes: {} },
        "sensor.factorio_main_vulcanus_drills_depleted": { state: "3", attributes: { by_resource: { "iron-ore": { total: 12, depleted: 3 } } } },
      }),
      "vulcanus",
    )!;
    expect(p.chip).toBeNull();
    expect(bad(p)).toEqual(["Iron ore, depleted drills"]);
    expect(p.checks).not.toContain("Drills not depleted");
  });

  it("skips bodies that already have an alert and bodies with nothing to say", () => {
    const st = states({ "sensor.factorio_main_vulcanus_evolution": { state: "12", attributes: {} } });
    expect(find(st, "vulcanus", { alerting: new Set(["vulcanus"]) })).toBeUndefined();
    expect(find(st, "gleba")).toBeUndefined(); // built, but no data
  });
});
