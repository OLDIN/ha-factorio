// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { planetsModel } from "../src/planets/model";
import type { Hass, HassState } from "../src/shared/types";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const ago = (min: number): string => new Date(NOW - min * 60_000 - 5_000).toISOString();

const BODIES = [
  { name: "nauvis", kind: "planet", state: "built" },
  { name: "gleba", kind: "planet", state: "built" },
  { name: "vulcanus", kind: "planet", state: "built" },
  { name: "fulgora", kind: "planet", state: "built" },
  { name: "rubia", kind: "planet", state: "unlocked" },
  { name: "secretas", kind: "planet", state: "locked" },
  { name: "maraxsis", kind: "planet", state: "locked" },
  { name: "shattered-planet", kind: "space-location", state: "unlocked" },
];

const STATES: Record<string, HassState> = {
  "sensor.factorio_main_bodies": { state: "4", attributes: { bodies: BODIES } },
  "binary_sensor.factorio_main_gleba_under_attack": {
    state: "on",
    last_changed: ago(4),
    attributes: { losses: { "gun-turret": 7, "medium-electric-pole": 7, "bulk-inserter": 6, substation: 1 } },
  },
  "sensor.factorio_main_gleba_turrets_no_ammo": { state: "14", attributes: { no_power: 0 } },
  "sensor.factorio_main_nauvis_turrets_no_ammo": { state: "25", attributes: { no_power: 2 } },
  "sensor.factorio_main_nauvis_walls_damaged": { state: "0", attributes: {} },
  "sensor.factorio_main_nauvis_evolution": { state: "99.1", attributes: {} },
  "sensor.factorio_main_gleba_evolution": { state: "88.93", attributes: {} },
  "sensor.factorio_main_vulcanus_evolution": { state: "79.2", attributes: {} },
  "sensor.factorio_main_research": { state: "planet-discovery-maraxsis", attributes: { progress: 62, unlocks: ["maraxsis"] } },
};

describe("planetsModel", () => {
  it("puts planets that need attention first, attacks before defense", () => {
    const m = planetsModel(STATES, "main", "en", NOW);
    expect(m.attention.map((p) => p.name)).toEqual(["gleba", "nauvis"]);
    expect(m.attention[0].tone).toBe("red");
    expect(m.attention[0].lines).toEqual([
      { text: "Attack for 4 min: lost Gun turret\u00a0×7, Medium electric pole\u00a0×7, Bulk inserter\u00a0×6, +1 more", tone: "red" },
      { text: "14 turrets without ammo", tone: "amber" },
    ]);
    expect(m.attention[0].evolution).toBeCloseTo(88.93, 2);
    expect(m.attention[1].tone).toBe("amber");
    expect(m.attention[1].lines.map((l) => l.text)).toEqual(["25 turrets without ammo", "2 turrets without power"]);
  });

  it("lists healthy, unlocked and locked planets; space locations are not planets", () => {
    const m = planetsModel(STATES, "main", "en", NOW);
    expect(m.healthy.map((p) => [p.name, p.evolution])).toEqual([
      ["vulcanus", 79.2],
      ["fulgora", null],
    ]);
    expect(m.unlocked).toEqual(["rubia"]);
    expect(m.locked).toEqual([
      { name: "maraxsis", progress: 62 },
      { name: "secretas", progress: null },
    ]);
  });

  it("does not count attack minutes while the game is paused", () => {
    const paused = { ...STATES, "sensor.factorio_main_game_state": { state: "paused", attributes: {} } };
    expect(planetsModel(paused, "main", "uk", NOW).attention[0].lines[0].text).toBe(
      "Напад, гра на паузі: втрачено Gun turret\u00a0×7, Medium electric pole\u00a0×7, Bulk inserter\u00a0×6, ще 1",
    );
  });

  it("is empty without the bodies sensor and tolerates Lua's empty tables", () => {
    expect(planetsModel({}, "main", "en", NOW)).toEqual({ attention: [], healthy: [], unlocked: [], locked: [], total: 0 });
    const odd = { "sensor.factorio_main_bodies": { state: "0", attributes: { bodies: {} } } };
    expect(planetsModel(odd, "main", "en", NOW).total).toBe(0);
  });
});

function hass(states: Record<string, HassState>, language = "uk"): Hass {
  return { states, language, locale: { language } };
}

describe("factorio-planets-card", () => {
  beforeAll(async () => {
    await import("../src/index");
  });

  async function mount(h: Hass) {
    const el = document.createElement("factorio-planets-card") as HTMLElement & {
      setConfig(c: unknown): void;
      hass: Hass;
      updateComplete: Promise<boolean>;
    };
    el.setConfig({ server_id: "main" });
    el.hass = h;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it("renders the attention rows, the healthy chips and the unlocked / locked lists", async () => {
    const el = await mount(hass({ ...STATES, "binary_sensor.factorio_main_gleba_under_attack": { ...STATES["binary_sensor.factorio_main_gleba_under_attack"], last_changed: new Date().toISOString() } }));
    const root = el.shadowRoot!;
    expect(root.querySelector("h2")?.textContent).toBe("Планети");
    const rows = [...root.querySelectorAll(".row")];
    expect(rows.map((r) => r.querySelector(".name")?.textContent)).toEqual(["Глеба", "Наувіс"]);
    expect(rows[0].classList.contains("red")).toBe(true);
    expect(rows[0].querySelector(".evo b")?.textContent).toBe("89%");
    expect(root.querySelectorAll(".healthy li")).toHaveLength(2);
    expect(root.querySelector(".healthy .count")?.textContent).toBe("2");
    // In the mockup that number is the share of working machines (stage 2b): say what it is now.
    expect(root.querySelector(".healthy .hint")?.textContent).toBe("відсоток — еволюція ворогів");
    expect([...root.querySelectorAll(".unlocked li")].map((li) => li.textContent?.trim())).toEqual(["Rubia"]);
    const locked = [...root.querySelectorAll(".locked li")];
    expect(locked).toHaveLength(2);
    expect(locked[0].textContent).toContain("62%");
    el.remove();
  });

  it("says when every built planet is fine", async () => {
    const el = await mount(hass({ "sensor.factorio_main_bodies": STATES["sensor.factorio_main_bodies"] }, "en"));
    expect(el.shadowRoot!.querySelector(".calm")?.textContent).toBe("No built planet needs attention");
    expect(el.shadowRoot!.querySelectorAll(".healthy li")).toHaveLength(4);
    el.remove();
  });

  it("asks for the server id and finds it for a new card", async () => {
    const el = document.createElement("factorio-planets-card") as HTMLElement & { setConfig(c: unknown): void; hass: Hass; updateComplete: Promise<boolean> };
    el.setConfig({ server_id: "" });
    el.hass = hass({}, "en");
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".message")?.textContent).toContain("server_id");
    el.remove();
    const ctor = customElements.get("factorio-planets-card") as unknown as { getStubConfig(h: Hass): { server_id: string } };
    expect(ctor.getStubConfig(hass(STATES)).server_id).toBe("main");
  });
});
