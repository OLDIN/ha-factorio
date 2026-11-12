// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { PLATFORM_ROWS, platformTone, readPlatforms } from "../src/shared/platforms";
import type { Hass, HassState } from "../src/shared/types";

const LINE = { recipe: "thruster-fuel", reason: "no_input", stopped: 6, total: 10, minutes: 3 };

function platform(index: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { index, name: `Hauler ${index}`, state: "no_schedule", location: "nauvis", route: null, damage: null, lines: [], lines_more: 0, ...fields };
}

/** The six platforms of the mockup, with English names as in the dev scenario. */
const MOCKUP = [
  platform(1, { name: "Science", state: "no_schedule", location: "nauvis" }),
  platform(2, { name: "Hauler 1", state: "on_the_path", location: null, route: { from: "nauvis", to: "aquilo", progress: 0.3 } }),
  platform(3, {
    name: "Hauler 2", state: "on_the_path", location: null, route: { from: "fulgora", to: "gleba", progress: 0.62 },
    damage: { active: true, since_tick: 5, losses: { "transport-belt": 2 } },
  }),
  platform(4, { name: "Edge", state: "waiting_for_departure", location: "gleba" }),
  platform(5, { name: "Cryo", state: "paused", location: "aquilo" }),
  platform(6, { name: "Ore run", state: "on_the_path", location: null, route: { from: "vulcanus", to: "nauvis", progress: 0.35 } }),
];

function states(list: unknown, state?: string): Record<string, HassState> {
  return { "sensor.factorio_main_platforms": { state: state ?? String(Array.isArray(list) ? list.length : 0), attributes: { platforms: list } } };
}

describe("readPlatforms", () => {
  it("puts damaged platforms first, then ones with problem lines, then flying ones, then the rest by name", () => {
    const rows = readPlatforms(states([...MOCKUP, platform(7, { name: "Belts", lines: [LINE], lines_more: 1 })]), "main")!;
    expect(rows.map((r) => r.name)).toEqual(["Hauler 2", "Belts", "Hauler 1", "Ore run", "Cryo", "Edge", "Science"]);
    expect(rows[1].lines).toEqual([LINE]);
    expect(rows[1].linesMore).toBe(1);
  });

  it("maps game states to what the card says", () => {
    const kinds = Object.fromEntries(
      ["on_the_path", "waiting_for_departure", "waiting_at_station", "no_schedule", "paused", "no_path", "waiting_for_starter_pack",
        "starter_pack_requested", "starter_pack_on_the_way", "something_new"].map((state, i) => [
        state,
        readPlatforms(states([platform(i, { state })]), "main")![0].kind,
      ]),
    );
    expect(kinds).toEqual({
      on_the_path: "flying", waiting_for_departure: "waiting", waiting_at_station: "waiting", no_schedule: "parked", paused: "parked",
      no_path: "parked", waiting_for_starter_pack: "building", starter_pack_requested: "building", starter_pack_on_the_way: "building",
      something_new: "unknown",
    });
  });

  it("tones: damaged or with lines amber, flying cyan, the rest muted", () => {
    const rows = readPlatforms(states([...MOCKUP, platform(7, { lines: [LINE] })]), "main")!;
    const tone = (name: string): string => platformTone(rows.find((r) => r.name === name)!);
    expect([tone("Hauler 2"), tone("Hauler 7"), tone("Hauler 1"), tone("Science")]).toEqual(["amber", "amber", "cyan", "muted"]);
  });

  it("is empty for an empty list, null without the sensor or its data", () => {
    expect(readPlatforms(states([]), "main")).toEqual([]);
    expect(readPlatforms(states({}), "main")).toEqual([]); // Lua: an empty table may come as {}
    expect(readPlatforms({}, "main")).toBeNull();
    expect(readPlatforms(states([], "unknown"), "main")).toBeNull();
  });

  it("skips junk and keeps a bad route out", () => {
    const rows = readPlatforms(states(["junk", platform(1, { route: { from: "nauvis" }, state: "on_the_path" }), { name: "no index" }]), "main")!;
    expect(rows).toHaveLength(1);
    expect(rows[0].route).toBeNull();
  });
});

function hass(s: Record<string, HassState>, language = "uk"): Hass {
  return { states: s, language, locale: { language } };
}

describe("factorio-platforms-card", () => {
  beforeAll(async () => {
    await import("../src/index");
  });

  async function mount(h: Hass) {
    const el = document.createElement("factorio-platforms-card") as HTMLElement & {
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

  it("draws the mockup: title with count, where each one is or flies, damage in amber", async () => {
    const el = await mount(hass(states(MOCKUP)));
    const root = el.shadowRoot!;
    expect(root.querySelector("h2")!.textContent!.replace(/\s+/g, " ").trim()).toBe("Платформи 6");
    const rows = [...root.querySelectorAll(".row")];
    expect(rows).toHaveLength(6);
    const text = (i: number): string => rows[i].textContent!.replace(/\s+/g, " ").trim();
    expect(text(0)).toContain("«Hauler 2»");
    // formatLosses keeps the count with its item by a no-break space (text() above folds it into a space)
    expect(rows[0].querySelector(".damage")!.textContent).toBe("Пошкоджена: втрачено Transport belt\u00a0×2");
    expect(rows[0].classList.contains("amber")).toBe(true);
    expect(rows[0].querySelector(".route")!.textContent).toContain("Фульгора");
    expect(rows[0].querySelector(".route")!.textContent).toContain("Глеба");
    expect(rows[0].querySelector<HTMLElement>(".fill")!.style.width).toBe("62%");
    const all = rows.map((_, i) => text(i)).join(" | ");
    expect(all).toContain("стоїть біля Наувісу");
    expect(all).toContain("чекає біля Глеби");
    expect(all).toContain("стоїть біля Аквіло");
    expect(rows.filter((r) => r.classList.contains("cyan"))).toHaveLength(2);
    el.remove();
  });

  it("shows two problem lines of a platform and how many more", async () => {
    const lines = [LINE, { ...LINE, recipe: "ammonia" }];
    const el = await mount(hass(states([platform(1, { lines, lines_more: 3 })]), "en"));
    const row = el.shadowRoot!.querySelector(".row")!;
    expect(row.querySelectorAll(".line")).toHaveLength(3);
    expect(row.textContent).toContain("Thruster fuel: 6 of 10 stopped, no input, 3 min");
    expect(row.textContent).toContain("3 more");
    expect(row.textContent).toContain("parked at Nauvis");
    el.remove();
  });

  it(`shows ${PLATFORM_ROWS} platforms and expands the rest`, async () => {
    const many = Array.from({ length: 12 }, (_, i) => platform(i + 1, { name: `P${String(i + 1).padStart(2, "0")}` }));
    const el = await mount(hass(states(many)));
    const root = el.shadowRoot!;
    expect(root.querySelectorAll(".row")).toHaveLength(PLATFORM_ROWS);
    const more = root.querySelector<HTMLButtonElement>("button.more")!;
    expect(more.textContent!.trim()).toBe("ще 4");
    more.click();
    await el.updateComplete;
    expect(root.querySelectorAll(".row")).toHaveLength(12);
    expect(root.querySelector("button.more")!.textContent!.trim()).toBe("згорнути");
    el.remove();
  });

  it("says when there are no platforms", async () => {
    const el = await mount(hass(states([])));
    expect(el.shadowRoot!.textContent).toContain("Платформ ще немає");
    el.remove();
    const none = await mount(hass({}));
    expect(none.shadowRoot!.textContent).toContain("Платформ ще немає");
    none.remove();
  });
});
