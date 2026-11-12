// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import bodies21 from "./fixtures/bodies-21.json";
import type { Hass, HassState } from "../src/shared/types";
import type { FactorioMapCard } from "../src/map/factorio-map-card";

const NOW = Date.now();

function hass(states: Record<string, HassState>, language = "en"): Hass {
  return { states, language, locale: { language } };
}

const DASHBOARD: Record<string, HassState> = {
  "sensor.factorio_main_bodies": { state: "13", attributes: { bodies: bodies21 } },
  "sensor.factorio_main_research": {
    state: "planet-discovery-maraxsis",
    attributes: { progress: 62, level: 1, queue: [], unlocks: ["maraxsis"] },
  },
  "binary_sensor.factorio_main_nauvis_under_attack": {
    state: "on",
    last_changed: new Date(NOW - 125_000).toISOString(),
    attributes: { since_tick: 1, position: [-412, 1180], gps: "", losses: { "gun-turret": 4, "stone-wall": 12 } },
  },
  "sensor.factorio_main_fulgora_turrets_no_ammo": { state: "6", attributes: { total: 48, no_power: 0, positions: [] } },
  "sensor.factorio_main_corrundum_walls_damaged": { state: "12", attributes: { positions: [] } },
};

async function mount(config: Record<string, unknown>, h?: Hass): Promise<FactorioMapCard> {
  const el = document.createElement("factorio-map-card") as FactorioMapCard;
  el.setConfig(config as never);
  if (h) el.hass = h;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

beforeAll(async () => {
  await import("../src/index");
});

describe("factorio-map-card", () => {
  it("draws every body, the callouts and an accessible summary", async () => {
    const el = await mount({ server_id: "main" }, hass(DASHBOARD));
    const root = el.shadowRoot!;
    const svgEl = root.querySelector("svg")!;
    expect(svgEl.getAttribute("role")).toBe("img");
    const aria = svgEl.getAttribute("aria-label")!;
    expect(aria).toContain("21 bodies in the system");
    expect(aria).toContain("Attack on Nauvis: 2 min");
    expect(aria).toContain("6 turrets without ammo");
    expect(aria).toContain("12 damaged walls");
    expect(aria).toContain("Maraxsis: researching 62%");
    expect(root.querySelectorAll("circle.body")).toHaveLength(21);
    // Only the attack keeps a callout; turrets and walls are in the popups (and the summary above).
    expect(root.querySelectorAll("g.callout")).toHaveLength(1);
    expect(root.querySelectorAll("g.callout.attack")).toHaveLength(1);
    expect([...root.querySelectorAll("circle.pulse")].map((c) => `${c.getAttribute("data-body")}:${c.classList[1]}`).sort()).toEqual([
      "corrundum:amber",
      "fulgora:amber",
      "nauvis:red",
    ]);
    expect([...root.querySelectorAll("g.count")].map((g) => `${g.getAttribute("data-body")}:${g.textContent!.trim()}`).sort()).toEqual([
      "corrundum:1",
      "fulgora:1",
    ]);
    expect([...root.querySelectorAll("circle.hit")].map((c) => c.getAttribute("data-body")).sort()).toEqual(["corrundum", "fulgora", "nauvis"]);
    expect(root.querySelectorAll("circle.research")).toHaveLength(1);
    expect(root.querySelectorAll("circle.hazard")).toHaveLength(1);
    expect(root.querySelectorAll("text.label")).toHaveLength(21);
    el.remove();
  });

  it("names vanilla bodies in Ukrainian", async () => {
    const el = await mount({ server_id: "main" }, hass(DASHBOARD, "uk"));
    const labels = [...el.shadowRoot!.querySelectorAll("text.label")].map((n) => n.textContent);
    expect(labels).toContain("Наувіс");
    expect(labels).toContain("Corrundum");
    el.remove();
  });

  it("draws the attack legend icon with stripes fine enough to read at its size", async () => {
    const el = await mount({ server_id: "main" }, hass(DASHBOARD));
    const root = el.shadowRoot!;
    const icon = root.querySelector("g.legend rect");
    expect(icon?.getAttribute("fill")).toBe("url(#fha-hz-sm)");
    const pattern = root.querySelector("pattern#fha-hz-sm")!;
    expect(Number(pattern.getAttribute("width"))).toBeLessThanOrEqual(6);
    el.remove();
  });

  it("draws a ring arc by the share of working machines with a percentage under the name", async () => {
    const h = hass({
      ...DASHBOARD,
      "sensor.factorio_main_vulcanus_machines_working": { state: "97", attributes: { total: 100, working: 97 } },
    });
    const el = await mount({ server_id: "main" }, h);
    const root = el.shadowRoot!;
    const arcs = root.querySelectorAll("circle.machines");
    expect(arcs).toHaveLength(1);
    const arc = arcs[0];
    const r = Number(arc.getAttribute("r"));
    const c = 2 * Math.PI * r;
    const [dash, gap] = arc.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBeCloseTo(c * 0.97, 1);
    expect(gap).toBeCloseTo(c, 1);
    const subs = [...root.querySelectorAll("text.sublabel")].map((n) => n.textContent);
    expect(subs).toContain("97%");
    el.remove();
  });

  it("puts the research progress before the machines share and draws no ring without data", async () => {
    const withData = hass({
      ...DASHBOARD,
      "sensor.factorio_main_maraxsis_machines_working": { state: "5", attributes: { total: 10, working: 5 } },
    });
    const el = await mount({ server_id: "main" }, withData);
    expect(el.shadowRoot!.querySelectorAll("circle.machines")).toHaveLength(0);
    el.remove();
    const el2 = await mount({ server_id: "main" }, hass(DASHBOARD));
    expect(el2.shadowRoot!.querySelectorAll("circle.machines")).toHaveLength(0);
    el2.remove();
  });

  it("makes a planet with only a problem line pulse with a count badge, without a callout; the ring and pulse legend", async () => {
    const h = hass({
      ...DASHBOARD,
      "sensor.factorio_main_gleba_problem_lines": {
        state: "1",
        attributes: { lines: [{ recipe: "scrap-recycling", reason: "output_full", stopped: 31, total: 48, minutes: 11 }] },
      },
    });
    const el = await mount({ server_id: "main" }, h);
    const root = el.shadowRoot!;
    expect(root.querySelectorAll("g.callout")).toHaveLength(1);
    expect(root.querySelector('circle.pulse.amber[data-body="gleba"]')).not.toBeNull();
    expect(root.querySelector('g.count[data-body="gleba"]')!.textContent!.trim()).toBe("1");
    const aria = root.querySelector("svg")!.getAttribute("aria-label")!;
    expect(aria).toContain("Gleba: line stopped");
    expect(aria).toContain("Scrap recycling: 31 of 48 stopped, output full, 11 min");
    const legend = root.querySelector("g.legend")!.textContent!;
    expect(legend).toContain("ring: share of machines without problems");
    expect(legend).toContain("pulse: problems — hover or tap");
    el.remove();
    const uk = await mount({ server_id: "main" }, hass(DASHBOARD, "uk"));
    const ukLegend = uk.shadowRoot!.querySelector("g.legend")!.textContent;
    expect(ukLegend).toContain("кільце: частка машин без проблем");
    expect(ukLegend).toContain("пульс: є проблеми — наведіть або натисніть");
    uk.remove();
  });

  it("caps the attack callout at five rows and says how many more", async () => {
    const lines = Array.from({ length: 7 }, (_, i) => ({ recipe: `recipe-${i}`, reason: "no_input", stopped: 5, total: 10, minutes: 3 }));
    const h = hass({ ...DASHBOARD, "sensor.factorio_main_nauvis_problem_lines": { state: "7", attributes: { lines } } });
    const el = await mount({ server_id: "main" }, h);
    const callout = el.shadowRoot!.querySelector("g.callout.attack")!.textContent!;
    // Losses, position and 7 lines = 9 rows: the first five, then "4 more".
    expect(callout).toContain("Recipe 2");
    expect(callout).not.toContain("Recipe 3");
    expect(callout).toContain("4 more");
    el.remove();
  });

  it("colours the machines ring by the planet's problems and fills it with machines without problems", async () => {
    const h = hass({
      ...DASHBOARD,
      "sensor.factorio_main_vulcanus_machines_working": { state: "80", attributes: { total: 100, working: 97, ok: 80 } },
      "sensor.factorio_main_gleba_machines_working": { state: "50", attributes: { total: 10, working: 9, ok: 5 } },
      "sensor.factorio_main_gleba_problem_lines": {
        state: "1",
        attributes: { lines: [{ recipe: "yumako-processing", reason: "no_input", stopped: 4, total: 6, minutes: 3 }] },
      },
    });
    const el = await mount({ server_id: "main" }, h);
    const root = el.shadowRoot!;
    const arcs = [...root.querySelectorAll("circle.machines")];
    expect(arcs.map((a) => a.getAttribute("class")).sort()).toEqual(["machines amber", "machines green"]);
    const green = arcs.find((a) => a.classList.contains("green"))!;
    const c = 2 * Math.PI * Number(green.getAttribute("r"));
    expect(Number(green.getAttribute("stroke-dasharray")!.split(" ")[0])).toBeCloseTo(c * 0.8, 1);
    expect([...root.querySelectorAll("text.sublabel")].map((n) => n.textContent)).toEqual(expect.arrayContaining(["80%", "50%"]));
    el.remove();
  });

  it("draws the space platforms: diamonds on routes and next to bodies, a callout for the damaged one", async () => {
    const platforms = [
      { index: 1, name: "Science", state: "no_schedule", location: "nauvis", route: null, damage: null, lines: [], lines_more: 0 },
      { index: 2, name: "Hauler 1", state: "on_the_path", location: null, route: { from: "nauvis", to: "aquilo", progress: 0.3 },
        damage: null, lines: [], lines_more: 0 },
      { index: 3, name: "Hauler 2", state: "on_the_path", location: null, route: { from: "fulgora", to: "gleba", progress: 0.62 },
        damage: { active: true, since_tick: 5, losses: { "transport-belt": 2 } }, lines: [], lines_more: 0 },
      { index: 4, name: "Edge", state: "waiting_for_departure", location: "gleba", route: null, damage: null, lines: [], lines_more: 0 },
    ];
    const h = hass({ ...DASHBOARD, "sensor.factorio_main_platforms": { state: "4", attributes: { platforms } } }, "uk");
    const el = await mount({ server_id: "main" }, h);
    const root = el.shadowRoot!;
    expect(root.querySelectorAll("path.platform")).toHaveLength(4);
    expect(root.querySelectorAll("path.platform.amber")).toHaveLength(1);
    expect(root.querySelectorAll("path.platform.cyan")).toHaveLength(1);
    expect(root.querySelectorAll("path.proute")).toHaveLength(2);
    const warnings = [...root.querySelectorAll("g.callout.warning")];
    expect(warnings).toHaveLength(1);
    expect(warnings[0].textContent).toContain("«Hauler 2»: пошкоджена");
    expect(warnings[0].textContent).toContain("втрачено Transport belt");
    expect(root.querySelector("g.legend")!.textContent).toContain("ромб: платформа, жовтий — пошкоджена");
    expect(root.querySelector("svg")!.getAttribute("aria-label")).toContain("«Hauler 2»: пошкоджена");
    el.remove();
  });

  describe("popup", () => {
    const GLEBA_LINES = Array.from({ length: 7 }, (_, i) => ({ recipe: `recipe-${i}`, reason: "no_input", stopped: 5, total: 10, minutes: 3 }));
    const POPUP_STATES = hass({
      ...DASHBOARD,
      "sensor.factorio_main_gleba_problem_lines": { state: "7", attributes: { lines: GLEBA_LINES } },
      "sensor.factorio_main_gleba_machines_working": { state: "50", attributes: { total: 10, working: 9, ok: 5 } },
    });

    /** Until the popup has been measured and placed (updated() sets state, so updateComplete is false until then). */
    async function settle(el: FactorioMapCard): Promise<void> {
      for (let i = 0; i < 5 && !(await el.updateComplete); i++);
    }
    const hit = (el: FactorioMapCard, body: string): Element => el.shadowRoot!.querySelector(`circle.hit[data-body="${body}"]`)!;
    const popup = (el: FactorioMapCard): HTMLElement | null => el.shadowRoot!.querySelector<HTMLElement>(".popup");
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

    it("opens on hover, placed and visible, with a lead to the planet; closes a moment after the pointer leaves", async () => {
      const el = await mount({ server_id: "main" }, POPUP_STATES);
      expect(popup(el)).toBeNull();
      hit(el, "gleba").dispatchEvent(new Event("pointerenter"));
      await settle(el);
      const p = popup(el)!;
      expect(p.dataset.key).toBe("gleba|top");
      expect(p.getAttribute("style")).not.toContain("hidden");
      expect(p.classList.contains("warning")).toBe(true);
      expect(p.querySelector(".ptitle")!.textContent).toBe("Gleba: lines stopped (7)");
      expect(p.querySelector(".pmachines")!.textContent!.trim()).toBe("5 of 10 machines OK");
      expect(el.shadowRoot!.querySelector("g.plead.warning")).not.toBeNull();
      hit(el, "gleba").dispatchEvent(new Event("pointerleave"));
      await wait(250);
      await settle(el);
      expect(popup(el)).toBeNull();
      el.remove();
    });

    it("stays open while the pointer is on it", async () => {
      const el = await mount({ server_id: "main" }, POPUP_STATES);
      hit(el, "gleba").dispatchEvent(new Event("pointerenter"));
      await settle(el);
      hit(el, "gleba").dispatchEvent(new Event("pointerleave"));
      popup(el)!.dispatchEvent(new Event("pointerenter"));
      await wait(250);
      await settle(el);
      expect(popup(el)).not.toBeNull();
      el.remove();
    });

    it("shows five rows and expands the rest without closing", async () => {
      const el = await mount({ server_id: "main" }, POPUP_STATES);
      hit(el, "gleba").dispatchEvent(new Event("pointerenter"));
      await settle(el);
      expect(popup(el)!.querySelectorAll(".prow")).toHaveLength(5);
      const more = popup(el)!.querySelector<HTMLButtonElement>("button.more")!;
      expect(more.textContent!.trim()).toBe("2 more");
      more.click();
      await settle(el);
      expect(popup(el)!.dataset.key).toBe("gleba|open");
      expect(popup(el)!.querySelectorAll(".prow")).toHaveLength(7);
      expect(popup(el)!.querySelector("button.more")!.textContent!.trim()).toBe("show less");
      el.remove();
    });

    it("a click pins it; the same planet, Escape or the empty map close it; another planet switches", async () => {
      const el = await mount({ server_id: "main" }, POPUP_STATES);
      const pinGleba = async (): Promise<void> => {
        (hit(el, "gleba") as SVGElement).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
        await settle(el);
      };
      await pinGleba();
      hit(el, "gleba").dispatchEvent(new Event("pointerleave"));
      await wait(250);
      await settle(el);
      expect(popup(el)?.dataset.key).toBe("gleba|top"); // pinned: leaving does not close it

      hit(el, "gleba").dispatchEvent(new Event("pointerenter")); // back on the planet, as a click is
      await pinGleba(); // the same planet again
      expect(popup(el)).toBeNull();

      await pinGleba();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await settle(el);
      expect(popup(el)).toBeNull();

      await pinGleba();
      hit(el, "nauvis").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      await settle(el);
      expect(popup(el)?.dataset.key).toBe("nauvis|top");
      expect(popup(el)!.classList.contains("attack")).toBe(true);

      el.shadowRoot!.querySelector<HTMLElement>(".stage")!.click();
      await settle(el);
      expect(popup(el)).toBeNull();
      el.remove();
    });
  });

  it("treats a body named like an Object.prototype key as a plain name", async () => {
    const odd = ["constructor", "__proto__", "toString"].map((name, i) => ({
      name, kind: "planet", x: i * 20, y: -15, distance: 15 + i, orientation: 0.1 * i, magnitude: 1, parent: null,
      state: "built", unlocked_by: null,
    }));
    const states = { "sensor.factorio_main_bodies": { state: "3", attributes: { bodies: odd } } };
    const el = await mount({ server_id: "main" }, hass(states));
    const root = el.shadowRoot!;
    expect(root.querySelectorAll("circle.body")).toHaveLength(3);
    const labels = [...root.querySelectorAll("text.label")].map((n) => n.textContent ?? "");
    expect(labels).toHaveLength(3);
    for (const text of labels) expect(text).not.toMatch(/function|native code|\[object/);
    expect(root.querySelectorAll("text.sublabel")).toHaveLength(0);
    el.remove();
  });

  it("labels only alerts and research when label_healthy is off", async () => {
    const el = await mount({ server_id: "main", label_healthy: false }, hass(DASHBOARD, "uk"));
    const labels = [...el.shadowRoot!.querySelectorAll("text.label")].map((n) => n.textContent);
    expect(labels.sort()).toEqual(["Corrundum", "Maraxsis", "Наувіс", "Фульгора"]);
    expect(el.shadowRoot!.querySelector("svg")!.getAttribute("aria-label")).toContain("21 тіло в системі");
    el.remove();
  });

  it("shows a message without bodies or without server_id", async () => {
    const empty = await mount({ server_id: "main" }, hass({ "sensor.factorio_main_bodies": { state: "0", attributes: { bodies: {} } } }));
    expect(empty.shadowRoot!.querySelector("svg")).toBeNull();
    expect(empty.shadowRoot!.textContent).toContain("No bodies yet");
    empty.remove();
    const missing = await mount({ server_id: "main" }, hass({}));
    expect(missing.shadowRoot!.textContent).toContain("No bodies yet");
    missing.remove();
    const noServer = await mount({ server_id: "" }, hass(DASHBOARD));
    expect(noServer.shadowRoot!.textContent).toContain("server_id");
    noServer.remove();
  });

  it("sizes itself from the config", async () => {
    const el = await mount({ server_id: "main", height: 5000 }, hass(DASHBOARD));
    expect(el.shadowRoot!.querySelector("svg")!.getAttribute("height")).toBe("1200");
    expect(el.getCardSize()).toBe(24);
    el.setConfig({ server_id: "main" });
    expect(el.getCardSize()).toBe(13);
    expect(el.getGridOptions()).toEqual({ columns: "full", min_columns: 6 });
    el.remove();
  });

  it("stub config takes the server of the first bodies sensor", async () => {
    const ctor = customElements.get("factorio-map-card") as unknown as typeof FactorioMapCard;
    expect(ctor.getStubConfig(hass({ "sensor.other": { state: "1", attributes: {} }, "sensor.factorio_my_server_bodies": { state: "1", attributes: {} } }))).toEqual({
      server_id: "my_server",
    });
    expect(ctor.getStubConfig(hass({}))).toEqual({ server_id: "" });
    expect(ctor.getConfigElement().tagName.toLowerCase()).toBe("factorio-map-card-editor");
  });

  it("the editor sends config-changed from ha-form values", async () => {
    const editor = document.createElement("factorio-map-card-editor") as HTMLElement & {
      setConfig(c: unknown): void;
      updateComplete: Promise<boolean>;
    };
    editor.setConfig({ type: "custom:factorio-map-card", server_id: "main" });
    document.body.appendChild(editor);
    await editor.updateComplete;
    const form = editor.shadowRoot!.querySelector("ha-form") as HTMLElement & { schema: { name: string }[]; data: Record<string, unknown> };
    expect(form.schema.map((s) => s.name)).toEqual(["server_id", "height", "label_healthy"]);
    expect(form.data).toMatchObject({ server_id: "main", height: 640, label_healthy: true });
    let received: unknown;
    editor.addEventListener("config-changed", (e) => (received = (e as CustomEvent).detail.config));
    form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: { ...form.data, height: 800 } } }));
    expect(received).toMatchObject({ type: "custom:factorio-map-card", server_id: "main", height: 800 });
    editor.remove();
  });
});
