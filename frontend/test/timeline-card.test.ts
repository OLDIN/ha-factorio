// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import type { Hass } from "../src/shared/types";
import { buildPills } from "../src/timeline/factorio-timeline-card";

const NOW = Date.parse("2026-05-01T12:00:00Z");
const ago = (min: number): string => new Date(NOW - min * 60_000).toISOString();

const EVENTS = [
  { event: "attack_started", time: ago(2), data: { planet: "nauvis", surface: "nauvis", position: [1, 2], gps: "" } },
  { event: "turrets_no_ammo", time: ago(3), data: { planet: "nauvis", count: 6 } },
  { event: "research_finished", time: ago(41), data: { name: "planet-discovery-gleba", level: 2 } },
  { event: "player_joined", time: ago(24), data: { player: "alice" } },
  { event: "mystery", time: ago(5), data: [] },
  { event: "player_left", time: ago(90), data: { player: "bob" } },
];

describe("buildPills", () => {
  it("builds lane pills, skipping unknown and out-of-window events", () => {
    const pills = buildPills(EVENTS, "en", 60, NOW);
    expect(pills.map((p) => [p.lane, p.text])).toEqual([
      ["attacks", "Nauvis"],
      ["defense", "Nauvis: 6 without ammo"],
      ["players_science", "Planet discovery gleba 2"],
      ["players_science", "alice joined"],
    ]);
    expect(pills[0].x).toBeCloseTo(0.733, 3);
  });
  it("translates", () => {
    expect(buildPills(EVENTS, "uk", 60, NOW)[3].text).toBe("alice зайшов");
  });
  it("tolerates empty lists and dicts", () => {
    expect(buildPills([], "en", 60, NOW)).toEqual([]);
    expect(buildPills({}, "en", 60, NOW)).toEqual([]);
    expect(buildPills([{ event: "turrets_ok", time: ago(1), data: [] }], "en", 60, NOW)).toHaveLength(1);
  });
});

function hass(events: unknown, language = "en"): Hass {
  return { states: { "sensor.factorio_main_recent_events": { state: "1", attributes: { events } } }, language, locale: { language } };
}

describe("factorio-timeline-card", () => {
  beforeAll(async () => {
    await import("../src/index");
  });

  async function mount(h: Hass) {
    const el = document.createElement("factorio-timeline-card") as HTMLElement & { setConfig(c: unknown): void; hass: Hass; updateComplete: Promise<boolean> };
    el.setConfig({ server_id: "main" });
    el.hass = h;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it("shows pills on their lanes and filters with real buttons", async () => {
    const real = new Date().toISOString();
    const el = await mount(hass([{ event: "attack_started", time: real, data: { planet: "nauvis" } }, { event: "player_joined", time: real, data: { player: "alice" } }]));
    const root = el.shadowRoot!;
    expect(root.querySelector('[data-lane="attacks"] .pill')?.textContent).toContain("Nauvis");
    expect(root.querySelector('[data-lane="players_science"] .pill')?.textContent).toContain("alice joined");
    const chips = [...root.querySelectorAll<HTMLButtonElement>("button.chip")];
    expect(chips).toHaveLength(4);
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    chips[1].click();
    await el.updateComplete;
    expect(root.querySelectorAll(".lane")).toHaveLength(1);
    expect(root.querySelector("button.chip[aria-pressed=true]")).toBe(chips[1]);
    el.remove();
  });

  it("shows a calm message when nothing happened", async () => {
    const el = await mount(hass([]));
    expect(el.shadowRoot!.querySelector(".message")?.textContent).toContain("No events in the last hour");
    el.remove();
  });

  it("finds the server for a new card", async () => {
    const ctor = customElements.get("factorio-timeline-card") as unknown as { getStubConfig(h: Hass): { server_id: string } };
    expect(ctor.getStubConfig(hass([])).server_id).toBe("main");
  });
});
