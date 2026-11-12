import { LitElement, css, html, nothing, svg, unsafeCSS, type PropertyValues, type SVGTemplateResult } from "lit";
import { entityId, slug } from "../shared/entities";
import { t, tn } from "../shared/i18n";
import { bodyName } from "../shared/names";
import { planetColor } from "../shared/palette";
import { cardStyles, ensureFonts } from "../shared/theme";
import { asDict, asList, type Hass, type HassState } from "../shared/types";
import { machinesShare, readMachines, TOP_ROWS, type Machines } from "../shared/production";
import { HAZARD_STRIP, collectAlerts, formatLosses, placeCallouts, type Callout, type CalloutInput } from "./callouts";
import { readPlatforms, type PlatformRow } from "../shared/platforms";
import { placePlatforms, type PlatformsLayout } from "./platforms";
import { placePopup, type PopupPlace } from "./popup";
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
/** The popup's width (fixed in CSS) and a height to place it by before it is measured. */
const POPUP_WIDTH = 400;
const POPUP_GUESS = { width: POPUP_WIDTH, height: 160 };
/** Problem count shown on a badge; more reads "99+". */
const BADGE_MAX = 99;

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

/** Radius of the first ring around a body (status, research or attack). */
const ringRadius = (p: Placed): number => p.r + (p.parent !== null ? 4 : 5);

/** Radius of the outermost ring: the attack ring goes outside a status or research ring. */
function outerRadius(v: View, p: Placed): number {
  const doubled = v.attacked.has(p.name) && (v.research.has(p.name) || v.machines.has(p.name));
  return ringRadius(p) + (doubled ? 5 : 0);
}

/** Colour of a body with problems: red under attack, amber otherwise; null without problems. */
function toneOf(v: View, name: string): "red" | "amber" | null {
  const problem = v.problems.get(name);
  return problem === undefined ? null : problem.tone === "attack" ? "red" : "amber";
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
  /** Share (0–100) of machines without problems per built planet that reports machines. */
  machines: ReadonlyMap<string, number>;
  /** The machine counts behind `machines`, for the popup. */
  counts: ReadonlyMap<string, Machines>;
  /** Everything wrong with a body, as its popup shows it (attacks keep a callout on the map too). */
  problems: ReadonlyMap<string, CalloutInput>;
  sublabels: ReadonlyMap<string, string>;
  /** Space platforms: diamonds, routes and "+N". */
  platforms: PlatformsLayout;
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
    _hover: { state: true },
    _pinned: { state: true },
    _popupOpen: { state: true },
    _popupSize: { state: true },
  };

  declare hass?: Hass;
  declare _config?: MapCardConfig;
  declare _width: number;

  private _resize?: ResizeObserver;
  private _timer?: ReturnType<typeof setInterval>;
  private _hasAttack = false;
  private _layout?: { bodies: unknown; key: string; placed: Placed[] };
  /** The body under the pointer and the one whose popup stays open after a click. */
  declare _hover: string | null;
  declare _pinned: string | null;
  /** The popup shows every row, not only the first TOP_ROWS. */
  declare _popupOpen: boolean;
  /** The popup as measured, for the body and expansion it was measured with. */
  declare _popupSize: { key: string; width: number; height: number } | null;
  private _hideTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    this._width = 0;
    this._hover = null;
    this._pinned = null;
    this._popupOpen = false;
    this._popupSize = null;
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
    document.addEventListener("keydown", this._onKey);
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
    clearTimeout(this._hideTimer);
    document.removeEventListener("keydown", this._onKey);
  }

  /** The body whose popup is shown: the pinned one, else the one under the pointer. */
  private _active(): string | null {
    return this._pinned ?? this._hover;
  }

  /** Closes the popup, pinned or not. */
  private _close = (): void => {
    clearTimeout(this._hideTimer);
    this._pinned = null;
    this._hover = null;
  };

  private _onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this._active() !== null) this._close();
  };

  private _enter(name: string): void {
    clearTimeout(this._hideTimer);
    if (this._hover === name) return;
    if (this._pinned === null) this._popupOpen = false;
    this._hover = name;
  }

  /** Leaving a body or its popup closes the popup after a moment (time to move between them). */
  private _leave = (): void => {
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => (this._hover = null), 200);
  };

  private _stay = (): void => clearTimeout(this._hideTimer);

  /** A click pins the popup of a body; the same body again closes it, another one switches. */
  private _pin(name: string, e: Event): void {
    e.stopPropagation();
    if (this._pinned === name) {
      this._close();
      return;
    }
    if (this._active() !== name) this._popupOpen = false;
    this._pinned = name;
    this._hover = name;
  }

  private _toggleRows = (e: Event): void => {
    e.stopPropagation();
    this._popupOpen = !this._popupOpen;
  };

  /** The map is as wide as the box it scrolls in (inside ha-card's border and padding). */
  private _measure(): void {
    const width = Math.floor(this.renderRoot?.querySelector<HTMLElement>(".scroll")?.clientWidth ?? 0);
    if (width > 0 && Math.abs(width - this._width) >= 1) this._width = width;
  }

  /**
   * The popup is drawn hidden first, measured here, then placed. Its width is fixed in CSS;
   * its height is capped (max-height) only once placed, so a measurement never reads back a guess.
   */
  protected updated(): void {
    this._measure();
    const popup = this.renderRoot?.querySelector<HTMLElement>(".popup");
    const key = popup?.dataset.key;
    if (!popup || !key) return;
    const height = popup.offsetHeight || POPUP_GUESS.height;
    const known = this._popupSize;
    if (!known || known.key !== key || Math.abs(known.height - height) > 1) this._popupSize = { key, width: POPUP_WIDTH, height };
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
    // Machines without problems on built planets; research first when a body has both.
    const machines = new Map<string, number>();
    const counts = new Map<string, Machines>();
    for (const b of bodies) {
      if (b.state !== "built") continue;
      const m = readMachines(hass.states, sid, b.name);
      if (!m) continue;
      const share = machinesShare(m);
      machines.set(b.name, share);
      counts.set(b.name, m);
      const label = t(lang, "machines_share", { percent: Math.round(share) });
      const known = sublabels.get(b.name);
      sublabels.set(b.name, known === undefined ? label : `${known} · ${label}`);
    }
    const hidden = new Set<string>();
    if (this._config?.label_healthy === false)
      for (const b of bodies) if (!alerting.has(b.name) && !research.has(b.name)) hidden.add(b.name);

    const count = (state: string): number => bodies.filter((b) => b.state === state).length;
    const built = count("built");
    const unlocked = count("unlocked");
    const title = tn(lang, "map_bodies", bodies.length);
    const breakdown = t(lang, "map_breakdown", { built, unlocked, locked: bodies.length - built - unlocked });
    const header: Rect = { x0: 0, y0: 0, x1: 24 + Math.max(title.length * 13.5, breakdown.length * 6.6) + 16, y1: 80 };

    const items = ["built", "unlocked", "locked", "research", "attack", "machines", "pulse", "platform"].map((key) => ({ key, text: t(lang, `legend_${key}`) }));
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
    // Only attacks keep a callout on the map; every problem is in the body's popup.
    const permanent = alerts
      .filter((a) => a.tone === "attack")
      .map((a) =>
        a.lines.length <= TOP_ROWS
          ? a
          : { ...a, lines: [...a.lines.slice(0, TOP_ROWS), { text: t(lang, "pl_more", { count: a.lines.length - TOP_ROWS }), tone: "muted" as const }] },
      );
    // Space platforms; a damaged one keeps a callout too, at the body it stands at or flies to.
    const platformRows = readPlatforms(hass.states, sid) ?? [];
    const onMap = new Set(placed.map((p) => p.name));
    const platformName = (r: PlatformRow): string => t(lang, "pf_name", { name: r.name });
    for (const r of platformRows) {
      const anchor = r.location ?? r.route?.to ?? null;
      if (!r.damage || anchor === null || !onMap.has(anchor)) continue;
      const losses = formatLosses(r.damage.losses, lang);
      permanent.push({
        body: anchor,
        tone: "warning",
        title: t(lang, "pf_damaged_title", { name: platformName(r) }),
        lines: losses ? [{ text: t(lang, "pf_lost", { list: losses }), tone: "text" }] : [],
      });
    }
    const platforms = placePlatforms(platformRows, placed, (r) =>
      r.route
        ? `${platformName(r)}: ${bodyName(r.route.from, lang)} → ${bodyName(r.route.to, lang)}`
        : `${platformName(r)}: ${bodyName(r.location ?? "", lang)}`,
    );
    const callouts = placeCallouts(permanent, placed, {
      width,
      height,
      top: { x0: header.x1 + 8, x1: width - 16 },
      bottom: { x0: 16, x1: legendRect.x0 - 8 },
      labels: placed.filter((p) => !hidden.has(p.name)).map((p) => labelRect(p, sublabels.get(p.name))),
      sublabels,
    });

    const facts = [...alerts, ...permanent.filter((c) => c.tone === "warning")].map((a) => [a.title, ...a.lines.map((l) => l.text)].join(", "));
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
      machines,
      counts,
      problems: new Map(alerts.map((a) => [a.body, a])),
      sublabels,
      platforms,
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
    const popup = this._placePopup(v);
    return html`<ha-card>
      <div class="scroll">
        <div class="stage" style="width:${v.width}px;height:${v.height}px" @click=${this._close}>
          <svg
            role="img"
            aria-label=${v.aria}
            width=${v.width}
            height=${v.height}
            viewBox="0 0 ${v.width} ${v.height}"
          >
            ${this._defs()} ${this._backdrop(v)} ${this._routes(v)} ${v.callouts.map((c) => this._calloutLine(c))}
            ${v.placed.filter((p) => p.parent === null).map((p) => this._body(v, p))}
            ${v.placed.filter((p) => p.parent !== null).map((p) => this._body(v, p))} ${this._platforms(v)}
            ${v.placed.map((p) => this._label(v, p))} ${v.callouts.map((c) => this._callout(c))} ${this._header(v)}
            ${this._legend(v)} ${popup?.measured && popup.place.line ? this._popupLead(popup.place.line, popup.problem.tone) : nothing}
            ${v.placed.filter((p) => v.problems.has(p.name)).map((p) => this._hit(v, p))}
          </svg>
          ${popup ? this._popup(v, popup) : nothing}
        </div>
      </div>
    </ha-card>`;
  }

  /** Where the popup of the active body goes, from its measured size (or a guess while it is being measured). */
  private _placePopup(v: View): { name: string; key: string; problem: CalloutInput; place: PopupPlace; measured: boolean } | null {
    const name = this._active();
    const problem = name === null ? undefined : v.problems.get(name);
    const p = name === null ? undefined : v.placed.find((b) => b.name === name);
    if (name === null || !problem || !p) return null;
    const key = `${name}|${this._popupOpen ? "open" : "top"}`;
    const measured = this._popupSize?.key === key;
    const size = measured ? this._popupSize! : POPUP_GUESS;
    return { name, key, problem, measured, place: placePopup({ cx: p.cx, cy: p.cy, r: outerRadius(v, p) + 2 }, v, size) };
  }

  private _popup(v: View, pop: NonNullable<ReturnType<FactorioMapCard["_placePopup"]>>) {
    const { problem, place } = pop;
    const m = v.counts.get(pop.name);
    const rows = this._popupOpen ? problem.lines : problem.lines.slice(0, TOP_ROWS);
    // Hidden at the corner until measured; then placed, its height capped to the map (it scrolls inside).
    const style = pop.measured
      ? `left:${place.x}px;top:${place.y}px;max-height:${place.height}px`
      : "left:0;top:0;visibility:hidden";
    return html`<div
      class="popup ${problem.tone}"
      data-key=${pop.key}
      style=${style}
      role="dialog"
      aria-label=${problem.title}
      @click=${(e: Event) => e.stopPropagation()}
      @pointerenter=${this._stay}
      @pointerleave=${this._leave}
    >
      <div class="ptitle">${problem.title}</div>
      ${m
        ? html`<div class="pmachines">
            ${m.ok === null ? tn(v.lang, "pl_machines", m.total, { working: m.working }) : tn(v.lang, "pl_machines_ok", m.total, { ok: m.ok })}
          </div>`
        : nothing}
      ${rows.map((l) => html`<div class="prow ${l.tone}">${l.text}</div>`)}
      ${problem.lines.length > TOP_ROWS
        ? html`<button class="more" aria-expanded=${this._popupOpen ? "true" : "false"} @click=${this._toggleRows}>
            ${this._popupOpen ? t(v.lang, "pl_less") : t(v.lang, "pl_more", { count: problem.lines.length - TOP_ROWS })}
          </button>`
        : nothing}
    </div>`;
  }

  private _popupLead(line: NonNullable<PopupPlace["line"]>, tone: CalloutInput["tone"]): SVGTemplateResult {
    return svg`<g class="lead plead ${tone}">
      <path d="M${line.x1} ${line.y1} L${line.x2} ${line.y2}"></path><circle cx=${line.x1} cy=${line.y1} r="2.5"></circle>
    </g>`;
  }

  /** The pointer target of a body with problems: a little larger than everything drawn around it. */
  private _hit(v: View, p: Placed): SVGTemplateResult {
    return svg`<circle
      class="hit"
      data-body=${p.name}
      cx=${p.cx}
      cy=${p.cy}
      r=${Math.max(outerRadius(v, p) + 6, 14)}
      @pointerenter=${() => this._enter(p.name)}
      @pointerleave=${this._leave}
      @click=${(e: Event) => this._pin(p.name, e)}
    ></circle>`;
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
    const ring = ringRadius(p);
    const research = v.research.get(p.name);
    const share = v.machines.get(p.name);
    const attacked = v.attacked.has(p.name);
    const tone = toneOf(v, p.name);
    const parts: SVGTemplateResult[] = [];
    const c = 2 * Math.PI * ring;
    // A body with problems pulses (static under reduced motion): hover or tap it for the popup.
    if (tone !== null) parts.push(svg`<circle class="pulse ${tone}" data-body=${p.name} cx=${p.cx} cy=${p.cy} r=${outerRadius(v, p) + 3}></circle>`);
    if (share !== undefined && research === undefined)
      parts.push(svg`<circle class="ring" cx=${p.cx} cy=${p.cy} r=${ring}></circle>
        <circle class="machines ${tone ?? "green"}" cx=${p.cx} cy=${p.cy} r=${ring} stroke-dasharray="${(c * share) / 100} ${c}"
          transform="rotate(-90 ${p.cx} ${p.cy})"></circle>`);
    else if (body?.state === "built" && !moon && research === undefined && !attacked)
      parts.push(svg`<circle class="ring" cx=${p.cx} cy=${p.cy} r=${ring}></circle>`);
    if (research !== undefined) {
      parts.push(svg`<circle class="ring" cx=${p.cx} cy=${p.cy} r=${ring}></circle>
        <circle class="research" cx=${p.cx} cy=${p.cy} r=${ring} stroke-dasharray="${(c * research) / 100} ${c}"
          transform="rotate(-90 ${p.cx} ${p.cy})"></circle>`);
    }
    if (attacked)
      parts.push(svg`<circle class="hazard" cx=${p.cx} cy=${p.cy} r=${outerRadius(v, p)}
        stroke="url(#fha-hz)" stroke-width=${moon ? 3 : 4}></circle>`);
    if (body?.state === "built") {
      parts.push(svg`<circle class="body built" cx=${p.cx} cy=${p.cy} r=${p.r} fill=${color}></circle>`);
      if (!moon) parts.push(svg`<circle cx=${p.cx} cy=${p.cy} r=${p.r} fill="url(#fha-shade)"></circle>`);
    } else if (body?.state === "unlocked") {
      parts.push(svg`<circle class="body unlocked" cx=${p.cx} cy=${p.cy} r=${p.r} stroke=${color}></circle>`);
    } else {
      parts.push(svg`<circle class="body locked" cx=${p.cx} cy=${p.cy} r=${p.r} stroke=${color}></circle>`);
    }
    // How many problems a body has, on its upper right (attacks have their callout instead).
    const problem = v.problems.get(p.name);
    if (problem && problem.tone !== "attack") {
      const n = problem.lines.length;
      const text = n > BADGE_MAX ? `${BADGE_MAX}+` : String(n);
      const w = 10 + text.length * 6.5;
      const bx = p.cx + outerRadius(v, p) * Math.SQRT1_2;
      const by = p.cy - outerRadius(v, p) * Math.SQRT1_2;
      parts.push(svg`<g class="count" data-body=${p.name}>
        <rect x=${bx - w / 2} y=${by - 8} width=${w} height="16" rx="8"></rect>
        <text x=${bx} y=${by + 3.5} text-anchor="middle">${text}</text>
      </g>`);
    }
    return svg`<g>${parts}</g>`;
  }

  private _routes(v: View): SVGTemplateResult {
    return svg`${v.platforms.routes.map((r) => svg`<path class="proute" d="M${r.x1} ${r.y1} L${r.x2} ${r.y2}"></path>`)}`;
  }

  private _platforms(v: View): SVGTemplateResult {
    const S = 5.5; // half the diamond's diagonal
    return svg`${v.platforms.diamonds.map(
      (d) => svg`<path class="platform ${d.tone}" data-platform=${d.index}
        d="M${d.x} ${d.y - S} L${d.x + S} ${d.y} L${d.x} ${d.y + S} L${d.x - S} ${d.y} Z"><title>${d.title}</title></path>`,
    )}
    ${v.platforms.more.map((m) => svg`<text class="pmore" x=${m.x - 4} y=${m.y + 4}>+${m.count}</text>`)}`;
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
        case "machines":
          return svg`<circle class="ring" cx=${cx} cy=${cy} r="7" stroke-width="2.5"></circle>
            <path class="machines" d="M${cx} ${cy - 7} A7 7 0 1 1 ${cx - 6.06} ${cy + 3.5}" stroke-width="2.5"></path>`;
        case "platform":
          return svg`<path class="legend-platform" d="M${cx} ${cy - 5.5} L${cx + 5.5} ${cy} L${cx} ${cy + 5.5} L${cx - 5.5} ${cy} Z"></path>`;
        case "pulse":
          return svg`<circle class="legend-halo" cx=${cx} cy=${cy} r="7.5"></circle><circle class="legend-amber" cx=${cx} cy=${cy} r="4"></circle>`;
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
      .stage {
        position: relative;
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
      .machines {
        fill: none;
        stroke: var(--fha-green);
        stroke-width: 3;
      }
      .machines.amber {
        stroke: var(--fha-amber);
      }
      .machines.red {
        stroke: var(--fha-red);
      }
      .pulse {
        fill: none;
        stroke-width: 2.5;
        pointer-events: none;
        transform-box: fill-box;
        transform-origin: center;
        animation: fha-pulse 2.4s ease-out infinite;
      }
      .pulse.red {
        stroke: var(--fha-red);
      }
      .pulse.amber {
        stroke: var(--fha-amber);
      }
      @keyframes fha-pulse {
        0% {
          transform: scale(1);
          opacity: 0.9;
        }
        70%,
        100% {
          transform: scale(1.5);
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pulse {
          animation: none;
          opacity: 0.6;
        }
      }
      .count {
        pointer-events: none;
      }
      .count rect {
        fill: var(--fha-amber);
        stroke: var(--fha-bg);
        stroke-width: 1.5;
      }
      .count text {
        fill: var(--fha-bg);
        font-size: 10.5px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .hit {
        fill: transparent;
        pointer-events: all;
        cursor: pointer;
      }
      .plead {
        pointer-events: none;
      }
      .proute {
        fill: none;
        stroke: var(--fha-cyan);
        stroke-width: 1.2;
        stroke-dasharray: 4 5;
        opacity: 0.55;
        pointer-events: none;
      }
      .platform {
        stroke: var(--fha-bg);
        stroke-width: 1.5;
        fill: var(--fha-faint);
      }
      .platform.cyan {
        fill: var(--fha-cyan);
      }
      .platform.amber {
        fill: var(--fha-amber);
      }
      .pmore {
        font-size: 11px;
        fill: var(--fha-muted);
      }
      .popup {
        position: absolute;
        z-index: 1;
        box-sizing: border-box;
        width: ${unsafeCSS(POPUP_WIDTH)}px;
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 12px 14px;
        overflow-y: auto;
        border: 1px solid;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
        font-family: "Golos Text", system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.35;
        color: var(--fha-text);
      }
      .popup.attack {
        background: var(--fha-red-bg);
        border-color: var(--fha-red-border);
      }
      .popup.warning {
        background: var(--fha-amber-bg);
        border-color: var(--fha-amber-border);
      }
      .ptitle {
        font-family: Unbounded, "Golos Text", sans-serif;
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 2px;
      }
      .popup.attack .ptitle {
        color: var(--fha-red-soft);
      }
      .popup.warning .ptitle {
        color: var(--fha-amber-soft);
      }
      .pmachines,
      .prow.muted {
        font-size: 12px;
        color: var(--fha-soft);
      }
      .prow.amber {
        color: var(--fha-amber-soft);
      }
      .popup .more {
        align-self: flex-start;
        padding: 2px 0;
        border: 0;
        background: none;
        color: var(--fha-cyan);
        font: inherit;
        cursor: pointer;
      }
      .popup .more:hover {
        text-decoration: underline;
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
      .legend-amber {
        fill: var(--fha-amber);
      }
      .legend-platform {
        fill: var(--fha-amber);
      }
      .legend-halo {
        fill: none;
        stroke: var(--fha-amber);
        stroke-width: 2;
        opacity: 0.5;
      }
    `,
  ];
}
