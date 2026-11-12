// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { playersModel } from "../src/players/model";
import type { Hass, HassState } from "../src/shared/types";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const ago = (min: number): string => new Date(NOW - min * 60_000).toISOString();

function states(players: string[], afk: Record<string, number> | unknown[], events: unknown[]): Record<string, HassState> {
  return {
    "sensor.factorio_main_players_online": { state: String(players.length), attributes: { players, afk_minutes: afk } },
    "sensor.factorio_main_recent_events": { state: "x", attributes: { events } },
  };
}

const EVENTS = [
  { event: "player_died", time: ago(5), data: { player: "guest", planet: "gleba" } },
  { event: "player_left", time: ago(3), data: { player: "bob" } },
  { event: "player_died", time: ago(20), data: { player: "alice" } },
  { event: "player_died", time: ago(70), data: { player: "alice", planet: "nauvis" } },
  { event: "player_left", time: ago(9), data: { player: "carol" } },
];

describe("playersModel", () => {
  it("lists players in game first, then AFK ones", () => {
    const m = playersModel(states(["guest", "alice"], { guest: 4 }, []), "main", NOW);
    expect(m.online).toEqual([
      { name: "alice", afk: 0 },
      { name: "guest", afk: 4 },
    ]);
  });

  it("collects deaths of the last hour, newest first", () => {
    const m = playersModel(states([], [], EVENTS), "main", NOW);
    expect(m.deaths).toEqual([
      { player: "guest", planet: "gleba" },
      { player: "alice", planet: null },
    ]);
  });

  it("remembers who left last when nobody is online", () => {
    expect(playersModel(states([], [], EVENTS), "main", NOW).lastLeft).toEqual({ player: "bob", minutes: 3 });
    expect(playersModel(states(["alice"], [], EVENTS), "main", NOW).lastLeft).toBeNull();
  });

  it("is empty without entities", () => {
    expect(playersModel({}, "main", NOW)).toEqual({ online: [], deaths: [], lastLeft: null });
  });
});

function hass(s: Record<string, HassState>, language = "uk"): Hass {
  return { states: s, language, locale: { language } };
}

describe("factorio-players-card", () => {
  beforeAll(async () => {
    await import("../src/index");
  });

  async function mount(h: Hass) {
    const el = document.createElement("factorio-players-card") as HTMLElement & { setConfig(c: unknown): void; hass: Hass; updateComplete: Promise<boolean> };
    el.setConfig({ server_id: "main" });
    el.hass = h;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it("shows the players with their status, the count and the deaths", async () => {
    const now = Date.now();
    const recent = [{ event: "player_died", time: new Date(now - 60_000).toISOString(), data: { player: "guest", planet: "gleba" } }];
    const el = await mount(hass(states(["oldin", "guest"], { guest: 4 }, recent)));
    const root = el.shadowRoot!;
    expect(root.querySelector("h2")?.textContent).toBe("Гравці");
    expect(root.querySelector(".head .count")?.textContent).toBe("2");
    const rows = [...root.querySelectorAll(".player")].map((r) => [r.querySelector(".who")?.textContent?.trim(), r.querySelector(".status")?.textContent]);
    expect(rows).toEqual([
      ["oldin", "у грі"],
      ["guest", "AFK 4 хв"],
    ]);
    expect(root.querySelector(".player.afk")).not.toBeNull();
    expect(root.querySelector(".foot")?.textContent).toBe("За годину 1 смерть: guest (Глеба)");
    el.remove();
  });

  it("says nobody is online and who left last", async () => {
    const left = [{ event: "player_left", time: new Date(Date.now() - 5 * 60_000).toISOString(), data: { player: "oldin" } }];
    const el = await mount(hass(states([], [], left), "en"));
    const root = el.shadowRoot!;
    expect(root.querySelector(".nobody")?.textContent).toBe("Nobody online");
    expect(root.querySelector(".foot")?.textContent).toBe("oldin left, 5 min ago");
    el.remove();
  });
});
