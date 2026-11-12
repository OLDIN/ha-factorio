import { LitElement, css, html, nothing, svg, type PropertyValues, type SVGTemplateResult } from "lit";
import { entityId, slug } from "../shared/entities";
import { t, tn } from "../shared/i18n";
import { bodyName } from "../shared/names";
import { planetColor } from "../shared/palette";
import { cardStyles, ensureFonts } from "../shared/theme";
import { asDict, asList, type Hass, type HassState } from "../shared/types";
import { HAZARD_STRIP, collectAlerts, placeCallouts, type Callout } from "./callouts";
import { mapHeight, type MapCardConfig } from "./config";
import "./editor";
import {
  LEGEND_ROW,
  labelFont,
  labelRect,
  layoutBodies,
  legendLayout,
  sunGeometry,
  type Body,
  type Placed,
  type Rect,
} from "./layout";

/** Below this width the map keeps its layout and scrolls sideways (as the mockup does). */
const MIN_WIDTH = 960;
const FALLBACK_WIDTH = 1360;
const IDLE = new Set(["unknown", "unavailable", ""]);

function parseBodies(value: unknown): Body[] {
  return asList(value).filter(
    (b): b is Body =>
      b !== null && typeof b === "object" && !Array.isArray(b) && typeof (b as Body).name === "string" && (b as Body).name !== "",
  );
}

/** Bodies the current research unlocks, with its progress (0–100). */
function researchTargets(state: HassState | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!state || IDLE.has(state.state)) return out;
  const attrs = asDict(state.attributes);
  const p = Number(attrs.progress);
  const progress = Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
  for (const name of asList(attrs.unlocks)) if (typeof name === "string") out.set(name, progress);
  return out;
}

interface View {
  lang: string;
  width: number;
  height: number;
  bodies: Map<string, Body>;
  placed: Placed[];
  callouts: Callout[];
  attacked: Set<string>;
  research: Map<string, number>;
  sublabels: ReadonlyMap<string, string>;
  hidden: Set<string>;
  title: string;
  breakdown: string;
  legend: { x: number; y: number; items: { key: string; text: string }[] };
  aria: string;
}

export class FactorioMapCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _width: { state: true },
  };

  declare hass?: Hass;
  declare _config?: MapCardConfig;
  declare _width: number;

  private _resize?: ResizeObserver;
  private _timer?: ReturnType<typeof setInterval>;
  private _hasAttack = false;
  private _layout?: { bodies: unknown; key: string; placed: Placed[] };

  constructor() {
    super();
    this._width = 0;
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("factorio-map-card-editor");
  }

  /** The server of the first `sensor.factorio_*_bodies` entity. */
  static getStubConfig(hass?: Hass): MapCardConfig {
    for (const id of Object.keys(hass?.states ?? {})) {
      const match = /^sensor\.factorio_(.+)_bodies$/.exec(id);
      if (match) return { server_id: match[1] };
    }
    return { server_id: "" };
  }

  setConfig(config: MapCardConfig): void {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (config.server_id !== undefined && typeof config.server_id !== "string") throw new Error("server_id must be a string");
    this._config = { ...config };
  }

  getCardSize(): number {
    return Math.ceil(mapHeight(this._config) / 50);
  }

  /** Full width in the sections view; no `rows`: the card keeps its configured height. */
  getGridOptions(): { columns: "full"; min_columns: number } {
    return { columns: "full", min_columns: 6 };
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureFonts();
    if (typeof ResizeObserver !== "undefined") {
      this._resize = new ResizeObserver(() => this._measure());
      this._resize.observe(this);
    }
    // Keeps "attack for N min" current while an attack goes on.
    this._timer = setInterval(() => {
      if (this._hasAttack) this.requestUpdate();
    }, 30_000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resize?.disconnect();
    this._resize = undefined;
    clearInterval(this._timer);
  }

  /** The map is as wide as the box it scrolls in (inside ha-card's border and padding). */
  private _measure(): void {
    const width = Math.floor(this.renderRoot?.querySelector<HTMLElement>(".scroll")?.clientWidth ?? 0);
    if (width > 0 && Math.abs(width - this._width) >= 1) this._width = width;
  }

  protected updated(): void {
    this._measure();
  }

  /** HA sets `hass` on every state change anywhere; re-render only when one of ours changed. */
  protected shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size !== 1 || !changed.has("hass")) return true;
    const old = changed.get("hass") as Hass | undefined;
    const sid = this._config?.server_id;
    if (!old || !this.hass || !sid) return true;
    if ((old.locale?.language ?? old.language) !== (this.hass.locale?.language ?? this.hass.language)) return true;
    const prefixes = [`sensor.factorio_${slug(sid)}_`, `binary_sensor.factorio_${slug(sid)}_`];
    for (const id of new Set([...Object.keys(old.states), ...Object.keys(this.hass.states)]))
      if (prefixes.some((p) => id.startsWith(p)) && old.states[id] !== this.hass.states[id]) return true;
    return false;
  }

  private _lang(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _view(sid: string, bodiesRaw: unknown, bodies: Body[]): View {
    const hass = this.hass!;
    const lang = this._lang();
    const height = mapHeight(this._config);
    const width = Math.max(MIN_WIDTH, this._width || FALLBACK_WIDTH);
    const research = researchTargets(hass.states[entityId(sid, "sensor", "research")]);
    const alerts = collectAlerts(hass.states, sid, bodies, lang, Date.now());
    const attacked = new Set(alerts.filter((a) => a.tone === "attack").map((a) => a.body));
    const alerting = new Set(alerts.map((a) => a.body));

    const sublabels = new Map<string, string>();
    for (const [name, progress] of research) sublabels.set(name, t(lang, "research_progress", { progress: Math.round(progress) }));
    const hidden = new Set<string>();
    if (this._config?.label_healthy === false)
      for (const b of bodies) if (!alerting.has(b.name) && !research.has(b.name)) hidden.add(b.name);

    const count = (state: string): number => bodies.filter((b) => b.state === state).length;
    const built = count("built");
    const unlocked = count("unlocked");
    const title = tn(lang, "map_bodies", bodies.length);
    const breakdown = t(lang, "map_breakdown", { built, unlocked, locked: bodies.length - built - unlocked });
    const header: Rect = { x0: 0, y0: 0, x1: 24 + Math.max(title.length * 13.5, breakdown.length * 6.6) + 16, y1: 80 };

    const items = ["built", "unlocked", "locked", "research", "attack"].map((key) => ({ key, text: t(lang, `legend_${key}`) }));
    const { x: legendX, y: legendY, rect: legendRect } = legendLayout({ width, height }, items.map((i) => i.text));
    const legend = { x: legendX, y: legendY, items };

    const key = [lang, width, height, JSON.stringify([...sublabels]), [...hidden].join(","), Math.round(header.x1), Math.round(legend.x)].join("|");
    if (!this._layout || this._layout.bodies !== bodiesRaw || this._layout.key !== key)
      this._layout = {
        bodies: bodiesRaw,
        key,
        placed: layoutBodies(bodies, { width, height }, { sublabels, hidden, obstacles: [header, legendRect], title: (name) => bodyName(name, lang) }),
      };
    const placed = this._layout.placed;
    const callouts = placeCallouts(alerts, placed, {
      width,
      height,
      top: { x0: header.x1 + 8, x1: width - 16 },
      bottom: { x0: 16, x1: legendRect.x0 - 8 },
      labels: placed.filter((p) => !hidden.has(p.name)).map((p) => labelRect(p, sublabels.get(p.name))),
    });

    const facts = alerts.map((a) => [a.title, ...a.lines.map((l) => l.text)].join(", "));
    for (const [name, progress] of research)
      facts.push(`${bodyName(name, lang)}: ${t(lang, "research_progress", { progress: Math.round(progress) })}`);
    const aria = [`${t(lang, "map_title")}: ${title}`, breakdown, ...facts].join(". ");

    return {
      lang,
      width,
      height,
      bodies: new Map(bodies.map((b) => [b.name, b])),
      placed,
      callouts,
      attacked,
      research,
      sublabels,
      hidden,
      title,
      breakdown,
      legend,
      aria,
    };
  }

  render() {
    if (!this._config) return nothing;
    const lang = this._lang();
    const sid = (this._config.server_id ?? "").trim();
    if (!sid) return html`<ha-card><div class="message">${t(lang, "map_no_server")}</div></ha-card>`;
    if (!this.hass) return html`<ha-card></ha-card>`;
    const raw = this.hass.states[entityId(sid, "sensor", "bodies")]?.attributes?.bodies;
    const bodies = parseBodies(raw);
    if (bodies.length === 0) return html`<ha-card><div class="message">${t(lang, "map_no_bodies")}</div></ha-card>`;
    const v = this._view(sid, raw, bodies);
    this._hasAttack = v.attacked.size > 0;
    return html`<ha-card>
      <div class="scroll">
        <svg
          role="img"
          aria-label=${v.aria}
          width=${v.width}
          height=${v.height}
          viewBox="0 0 ${v.width} ${v.height}"
        >
          ${this._defs()} ${this._backdrop(v)} ${v.callouts.map((c) => this._calloutLine(c))}
          ${v.placed.filter((p) => p.parent === null).map((p) => this._body(v, p))}
          ${v.placed.filter((p) => p.parent !== null).map((p) => this._body(v, p))}
          ${v.placed.map((p) => this._label(v, p))} ${v.callouts.map((c) => this._callout(c))} ${this._header(v)}
          ${this._legend(v)}
        </svg>
      </div>
    </ha-card>`;
  }

  private _defs(): SVGTemplateResult {
    return svg`<defs>
      <pattern id="fha-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="grid"></path></pattern>
      <pattern id="fha-hz" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="12" class="hz-a"></rect><rect x="6" width="6" height="12" class="hz-b"></rect>
      </pattern>
      <pattern id="fha-hz-sm" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="3" height="6" class="hz-a"></rect><rect x="3" width="3" height="6" class="hz-b"></rect>
      </pattern>
      <radialGradient id="fha-sun" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" class="sun-core"></stop><stop offset="0.55" class="sun-mid"></stop><stop offset="1" class="sun-edge"></stop>
      </radialGradient>
      <radialGradient id="fha-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.6" class="glow" stop-opacity="0.22"></stop><stop offset="1" class="glow" stop-opacity="0"></stop>
      </radialGradient>
      <radialGradient id="fha-shade" cx="0.35" cy="0.3" r="0.75">
        <stop offset="0" class="shade-light" stop-opacity="0.28"></stop><stop offset="0.5" class="shade-light" stop-opacity="0"></stop>
        <stop offset="1" class="shade-dark" stop-opacity="0.45"></stop>
      </radialGradient>
    </defs>`;
  }

  private _backdrop(v: View): SVGTemplateResult {
    const sun = sunGeometry(v);
    const radii = new Set<number>();
    for (const p of v.placed) if (p.parent === null) radii.add(Math.round(Math.hypot(p.cx - sun.cx, p.cy - sun.cy) / 2) * 2);
    return svg`<rect width=${v.width} height=${v.height} fill="url(#fha-grid)"></rect>
      <g class="orbits">${[...radii].map((r) => svg`<circle cx=${sun.cx} cy=${sun.cy} r=${r}></circle>`)}</g>
      <circle cx=${sun.cx} cy=${sun.cy} r=${sun.r * 1.27} fill="url(#fha-glow)"></circle>
      <circle cx=${sun.cx} cy=${sun.cy} r=${sun.r} fill="url(#fha-sun)"></circle>
      ${v.attacked.size > 0 ? svg`<rect width=${v.width} height="6" fill="url(#fha-hz)"></rect>` : nothing}`;
  }

  private _body(v: View, p: Placed): SVGTemplateResult {
    const body = v.bodies.get(p.name);
    const color = planetColor(p.name);
    const moon = p.parent !== null;
    const ring = p.r + (moon ? 4 : 5);
    const research = v.research.get(p.name);
    const attacked = v.attacked.has(p.name);
    const parts: SVGTemplateResult[] = [];
    if (body?.state === "built" && !moon && research === undefined && !attacked)
      parts.push(svg`<circle class="ring" cx=${p.cx} cy=${p.cy} r=${ring}></circle>`);
    if (research !== undefined) {
      const c = 2 * Math.PI * ring;
      parts.push(svg`<circle class="ring" cx=${p.cx} cy=${p.cy} r=${ring}></circle>
        <circle class="research" cx=${p.cx} cy=${p.cy} r=${ring} stroke-dasharray="${(c * research) / 100} ${c}"
          transform="rotate(-90 ${p.cx} ${p.cy})"></circle>`);
    }
    if (attacked)
      parts.push(svg`<circle class="hazard" cx=${p.cx} cy=${p.cy} r=${research === undefined ? ring : ring + 5}
        stroke="url(#fha-hz)" stroke-width=${moon ? 3 : 4}></circle>`);
    if (body?.state === "built") {
      parts.push(svg`<circle class="body built" cx=${p.cx} cy=${p.cy} r=${p.r} fill=${color}></circle>`);
      if (!moon) parts.push(svg`<circle cx=${p.cx} cy=${p.cy} r=${p.r} fill="url(#fha-shade)"></circle>`);
    } else if (body?.state === "unlocked") {
      parts.push(svg`<circle class="body unlocked" cx=${p.cx} cy=${p.cy} r=${p.r} stroke=${color}></circle>`);
    } else {
      parts.push(svg`<circle class="body locked" cx=${p.cx} cy=${p.cy} r=${p.r} stroke=${color}></circle>`);
    }
    return svg`<g>${parts}</g>`;
  }

  private _label(v: View, p: Placed): SVGTemplateResult | typeof nothing {
    if (v.hidden.has(p.name)) return nothing;
    const body = v.bodies.get(p.name);
    const font = labelFont(p);
    const sub = v.sublabels.get(p.name);
    const cls =
      p.parent !== null
        ? "moon"
        : sub !== undefined
          ? "researched"
          : v.attacked.has(p.name)
            ? "alert"
            : body?.state === "built"
              ? "built"
              : "dim";
    return svg`<text class="label ${cls}" x=${p.label.x} y=${p.label.y} text-anchor=${p.label.anchor} font-size=${font}>${p.title ?? bodyName(p.name, v.lang)}</text>
      ${sub === undefined ? nothing : svg`<text class="sublabel" x=${p.label.x} y=${p.label.y + font + 3} text-anchor=${p.label.anchor} font-size=${font - 1}>${sub}</text>`}`;
  }

  private _calloutLine(c: Callout): SVGTemplateResult {
    const { x1, y1, x2, y2 } = c.line;
    return svg`<g class="lead ${c.tone}">
      <path d="M${x1} ${y1} L${x2} ${y2}"></path><circle cx=${x1} cy=${y1} r="2.5"></circle>
    </g>`;
  }

  private _callout(c: Callout): SVGTemplateResult {
    const { x, y, width: w } = c;
    const strip =
      c.tone === "attack"
        ? svg`<path d="M${x + 1} ${y + 1 + HAZARD_STRIP} V${y + 8} A7 7 0 0 1 ${x + 8} ${y + 1} H${x + w - 8} A7 7 0 0 1 ${x + w - 1} ${y + 8} V${y + 1 + HAZARD_STRIP} Z" fill="url(#fha-hz)"></path>`
        : nothing;
    return svg`<g class="callout ${c.tone}">
      <rect class="box" x=${x} y=${y} width=${w} height=${c.height} rx="8"></rect>${strip}
      <text class="ctitle" x=${x + 14} y=${c.baselines[0]}>${c.title}</text>
      ${c.lines.map((l, i) => svg`<text class="cline ${l.tone}" x=${x + 14} y=${c.baselines[i + 1]}>${l.text}</text>`)}
    </g>`;
  }

  private _header(v: View): SVGTemplateResult {
    return svg`<text class="title" x="24" y="44">${v.title}</text><text class="subtitle" x="24" y="68">${v.breakdown}</text>`;
  }

  private _legend(v: View): SVGTemplateResult {
    const icon = (key: string, cx: number, cy: number): SVGTemplateResult => {
      switch (key) {
        case "built":
          return svg`<circle class="ring" cx=${cx} cy=${cy} r="7" stroke-width="2.5"></circle><circle class="legend-fill" cx=${cx} cy=${cy} r="4"></circle>`;
        case "unlocked":
          return svg`<circle class="legend-icon" cx=${cx} cy=${cy} r="6"></circle>`;
        case "locked":
          return svg`<circle class="legend-icon" cx=${cx} cy=${cy} r="6" stroke-dasharray="2.5 2.5"></circle>`;
        case "research":
          return svg`<circle class="ring" cx=${cx} cy=${cy} r="7" stroke-width="2.5"></circle>
            <path class="research" d="M${cx} ${cy - 7} A7 7 0 0 1 ${cx + 7} ${cy}" stroke-width="2.5"></path>`;
        default:
          return svg`<rect x=${cx - 8} y=${cy - 3.5} width="16" height="7" rx="1" fill="url(#fha-hz-sm)"></rect>`;
      }
    };
    return svg`<g class="legend">${v.legend.items.map((item, i) => {
      const cy = v.legend.y + i * LEGEND_ROW;
      return svg`${icon(item.key, v.legend.x, cy - 4)}<text x=${v.legend.x + 16} y=${cy}>${item.text}</text>`;
    })}</g>`;
  }

  static styles = [
    cardStyles,
    css`
      :host {
        --fha-shade-light: #ffffff;
        --fha-shade-dark: #000000;
      }
      ha-card {
        display: block;
        overflow: hidden;
        background: var(--fha-bg);
        border: 1px solid var(--fha-line);
        border-radius: var(--ha-card-border-radius, 16px);
        color: var(--fha-text);
      }
      .message {
        padding: 16px;
        color: var(--fha-muted);
      }
      .scroll {
        overflow-x: auto;
        overflow-y: hidden;
      }
      svg {
        display: block;
        font-family: "Golos Text", system-ui, sans-serif;
      }
      .grid {
        fill: none;
        stroke: var(--fha-grid);
        stroke-width: 1;
      }
      .hz-a {
        fill: var(--fha-amber);
      }
      .hz-b {
        fill: var(--fha-bg);
      }
      .sun-core {
        stop-color: var(--fha-sun-core);
      }
      .sun-mid {
        stop-color: var(--fha-sun-mid);
      }
      .sun-edge {
        stop-color: var(--fha-sun-edge);
      }
      .glow {
        stop-color: var(--fha-sun-glow);
      }
      .shade-light {
        stop-color: var(--fha-shade-light);
      }
      .shade-dark {
        stop-color: var(--fha-shade-dark);
      }
      .orbits circle {
        fill: none;
        stroke: var(--fha-orbit);
        stroke-width: 1;
      }
      .ring {
        fill: none;
        stroke: var(--fha-line);
        stroke-width: 3;
      }
      .research {
        fill: none;
        stroke: var(--fha-cyan);
        stroke-width: 3;
      }
      .hazard {
        fill: none;
      }
      .body.unlocked {
        fill: none;
        stroke-width: 2;
      }
      .body.locked {
        fill: none;
        stroke-width: 1.6;
        stroke-dasharray: 3 3;
        opacity: 0.85;
      }
      .label {
        font-weight: 600;
        fill: var(--fha-text);
      }
      .label.dim {
        fill: var(--fha-faint);
        font-weight: 500;
      }
      .label.moon {
        fill: var(--fha-muted);
        font-weight: 500;
      }
      .label.researched {
        fill: var(--fha-cyan-soft);
      }
      .label.alert {
        fill: var(--fha-text);
        font-weight: 700;
      }
      .sublabel {
        fill: var(--fha-cyan);
      }
      .lead path {
        fill: none;
        stroke-width: 1.2;
      }
      .lead.attack path {
        stroke: var(--fha-red);
      }
      .lead.attack circle {
        fill: var(--fha-red);
      }
      .lead.warning path {
        stroke: var(--fha-amber);
      }
      .lead.warning circle {
        fill: var(--fha-amber);
      }
      .callout .box {
        stroke-width: 1;
      }
      .callout.attack .box {
        fill: var(--fha-red-bg);
        stroke: var(--fha-red-border);
      }
      .callout.warning .box {
        fill: var(--fha-amber-bg);
        stroke: var(--fha-amber-border);
      }
      .ctitle {
        font-family: Unbounded, "Golos Text", sans-serif;
        font-size: 13px;
        font-weight: 600;
      }
      .callout.attack .ctitle {
        fill: var(--fha-red-soft);
      }
      .callout.warning .ctitle {
        fill: var(--fha-amber-soft);
      }
      .cline {
        font-size: 13px;
        fill: var(--fha-text);
      }
      .cline.muted {
        font-size: 12px;
        fill: var(--fha-soft);
      }
      .cline.amber {
        fill: var(--fha-amber-soft);
      }
      .title {
        font-family: Unbounded, "Golos Text", sans-serif;
        font-size: 19px;
        font-weight: 600;
        fill: var(--fha-text);
      }
      .subtitle {
        font-size: 13px;
        fill: var(--fha-muted);
      }
      .legend text {
        font-size: 12px;
        fill: var(--fha-muted);
      }
      .legend-icon {
        fill: none;
        stroke: var(--fha-muted);
        stroke-width: 1.5;
      }
      .legend-fill {
        fill: var(--fha-muted);
      }
    `,
  ];
}
