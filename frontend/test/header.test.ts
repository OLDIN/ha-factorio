// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { headerModel } from "../src/header/model";
import type { Hass, HassState } from "../src/shared/types";

const STATES: Record<string, HassState> = {
  "sensor.factorio_main_game_state": { state: "running", attributes: {} },
  "sensor.factorio_main_players_online": { state: "2", attributes: { players: ["a", "b"] } },
  "sensor.factorio_main_bodies": { state: "2", attributes: { bodies: [{ name: "nauvis", state: "built" }, { name: "shattered-planet", state: "unlocked" }] } },
  "binary_sensor.factorio_main_nauvis_under_attack": { state: "on", attributes: {} },
  "binary_sensor.factorio_main_gleba_under_attack": { state: "off", attributes: {} },
  "binary_sensor.factorio_other_vulcanus_under_attack": { state: "on", attributes: {} },
  "sensor.factorio_main_research": {
    state: "research-productivity",
    attributes: { progress: 11.1, level: 17, queue: ["research-productivity", "a", "b", "c"], unlocks: [] },
  },
};

describe("headerModel", () => {
  it("reads the game state, attacks of this server, players and research", () => {
    expect(headerModel(STATES, "main")).toEqual({
      game: "running",
      attacked: ["nauvis"],
      players: 2,
      research: { name: "research-productivity", level: 17, progress: 11.1, queued: 3 },
    });
  });

  it("is blank without entities and ignores idle research", () => {
    expect(headerModel({ "sensor.factorio_main_research": { state: "unknown", attributes: {} } }, "main")).toEqual({
      game: null,
      attacked: [],
      players: null,
      research: null,
    });
  });
});

function hass(s: Record<string, HassState>, language = "uk"): Hass {
  return { states: s, language, locale: { language } };
}

describe("factorio-header-card", () => {
  beforeAll(async () => {
    await import("../src/index");
  });

  async function mount(h: Hass, config: Record<string, unknown> = { server_id: "main" }) {
    const el = document.createElement("factorio-header-card") as HTMLElement & { setConfig(c: unknown): void; hass: Hass; updateComplete: Promise<boolean> };
    el.setConfig(config);
    el.hass = h;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it("shows the title, the state chips and the research with its progress bar", async () => {
    const el = await mount(hass(STATES));
    const root = el.shadowRoot!;
    expect(root.querySelector("h1")?.textContent).toBe("Factorio");
    expect(root.querySelector(".chip.state")?.textContent?.trim()).toBe("Гра йде");
    expect(root.querySelector(".chip.state")?.classList.contains("running")).toBe(true);
    expect(root.querySelector(".chip.attack")?.textContent?.trim()).toBe("Напад на Наувіс");
    expect(root.querySelector(".players")?.textContent).toBe("2 гравці онлайн");
    expect(root.querySelector(".research .name")?.textContent).toBe("Research productivity 17");
    expect(root.querySelector(".research .pct")?.textContent).toBe("11%");
    expect(root.querySelector(".research .queue")?.textContent).toBe("ще 3 в черзі");
    expect((root.querySelector(".bar i") as HTMLElement).style.width).toBe("11.1%");
    el.remove();
  });

  it("puts the attacked planets in the accusative after «на»", async () => {
    const both = { ...STATES, "binary_sensor.factorio_main_gleba_under_attack": { state: "on", attributes: {} } };
    const el = await mount(hass(both));
    expect(el.shadowRoot!.querySelector(".chip.attack")?.textContent?.trim()).toBe("Напад на Глебу, Наувіс");
    el.remove();
  });

  it("shows a paused game, nobody online, no attack chip and a custom title", async () => {
    const quiet = {
      ...STATES,
      "sensor.factorio_main_game_state": { state: "paused", attributes: {} },
      "sensor.factorio_main_players_online": { state: "0", attributes: { players: [] } },
      "binary_sensor.factorio_main_nauvis_under_attack": { state: "off", attributes: {} },
    };
    const el = await mount(hass(quiet, "en"), { server_id: "main", title: "Base" });
    const root = el.shadowRoot!;
    expect(root.querySelector("h1")?.textContent).toBe("Base");
    expect(root.querySelector(".chip.state")?.textContent?.trim()).toBe("Game paused");
    expect(root.querySelector(".chip.attack")).toBeNull();
    expect(root.querySelector(".players")?.textContent).toBe("Nobody online");
    el.remove();
  });
});
