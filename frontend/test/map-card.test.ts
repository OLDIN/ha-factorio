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
    expect(root.querySelectorAll("g.callout")).toHaveLength(3);
    expect(root.querySelectorAll("g.callout.attack")).toHaveLength(1);
    expect(root.querySelectorAll("circle.research")).toHaveLength(1);
    expect(root.querySelectorAll("circle.hazard")).toHaveLength(1);
    expect(root.querySelectorAll("text.label")).toHaveLength(21);
    el.remove();
  });

  it("labels only alerts and research when label_healthy is off", async () => {
    const el = await mount({ server_id: "main", label_healthy: false }, hass(DASHBOARD, "uk"));
    const labels = [...el.shadowRoot!.querySelectorAll("text.label")].map((n) => n.textContent);
    expect(labels.sort()).toEqual(["Corrundum", "Fulgora", "Maraxsis", "Nauvis"]);
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
