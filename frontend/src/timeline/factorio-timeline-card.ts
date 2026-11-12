import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { entityId, slug } from "../shared/entities";
import { t } from "../shared/i18n";
import { cardStyles, ensureFonts } from "../shared/theme";
import { asDict, asList, type Hass } from "../shared/types";
import { prettyName } from "../map/layout";
import { windowMinutes, type TimelineCardConfig } from "./config";
import "./editor";
import { LANES, axisTicks, laneOf, logX, stackPills, type Lane } from "./scale";

type Filter = "all" | Lane;

const ROW_HEIGHT = 30;
const MAX_ROWS = 4;
const FALLBACK_WIDTH = 900;
const REFRESH_MS = 30_000;

interface Pill {
  key: string;
  lane: Lane;
  tone: "red" | "amber" | "green" | "cyan";
  /** Hollow marker: the thing is over (attack ended, ammo restored). */
  resolved: boolean;
  text: string;
  title: string;
  x: number;
  width: number;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Width of a pill in px: text plus the marker and the padding (an estimate; used for stacking only). */
const pillWidth = (text: string): number => Math.ceil(text.length * 6.9 + 34);

export function eventText(lang: string, event: string, data: Record<string, unknown>): string | null {
  const planet = prettyName(str(data.planet));
  const player = str(data.player);
  switch (event) {
    case "attack_started":
      return t(lang, "tl_attack", { planet });
    case "attack_ended":
      return t(lang, "tl_attack_ended", { planet });
    case "turrets_no_ammo":
      return t(lang, "tl_no_ammo", { planet, count: Number(data.count) || 0 });
    case "turrets_ok":
      return t(lang, "tl_ammo_ok", { planet });
    case "research_finished": {
      const name = prettyName(str(data.name));
      const level = Number(data.level);
      return level > 1 ? t(lang, "tl_research_level", { name, level }) : t(lang, "tl_research", { name });
    }
    case "player_joined":
      return t(lang, "tl_joined", { player });
    case "player_left":
      return t(lang, "tl_left", { player });
    case "player_died":
      return t(lang, "tl_died", { player });
    default:
      return null;
  }
}

const TONES: Record<string, { tone: Pill["tone"]; resolved: boolean }> = {
  attack_started: { tone: "red", resolved: false },
  attack_ended: { tone: "red", resolved: true },
  turrets_no_ammo: { tone: "amber", resolved: false },
  turrets_ok: { tone: "green", resolved: true },
};

/** Events of the last `windowMin` minutes as pills (unknown events and bad timestamps are skipped). */
export function buildPills(raw: unknown, lang: string, windowMin: number, now: number): Pill[] {
  const pills: Pill[] = [];
  asList(raw).forEach((item, i) => {
    const e = asDict(item);
    const event = str(e.event);
    const lane = laneOf(event);
    const at = Date.parse(str(e.time));
    if (lane === null || !Number.isFinite(at)) return;
    const minutes = Math.max(0, (now - at) / 60_000);
    if (minutes > windowMin) return;
    const text = eventText(lang, event, asDict(e.data));
    if (text === null) return;
    const ago = minutes < 1 ? t(lang, "tl_ago_now") : t(lang, "tl_ago", { minutes: Math.round(minutes) });
    pills.push({
      key: `${i}-${event}-${str(e.time)}`,
      lane,
      ...(TONES[event] ?? { tone: lane === "defense" ? "amber" : "cyan", resolved: false }),
      text,
      title: `${text}, ${ago}`,
      x: logX(minutes, windowMin),
      width: pillWidth(text),
    });
  });
  return pills;
}

export class FactorioTimelineCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _filter: { state: true },
    _width: { state: true },
  };

  declare hass?: Hass;
  declare _config?: TimelineCardConfig;
  declare _filter: Filter;
  declare _width: number;

  private _resize?: ResizeObserver;
  private _timer?: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this._filter = "all";
    this._width = 0;
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("factorio-timeline-card-editor");
  }

  /** The server of the first `sensor.factorio_*_recent_events` entity. */
  static getStubConfig(hass?: Hass): TimelineCardConfig {
    for (const id of Object.keys(hass?.states ?? {})) {
      const match = /^sensor\.factorio_(.+)_recent_events$/.exec(id);
      if (match) return { server_id: match[1] };
    }
    return { server_id: "" };
  }

  setConfig(config: TimelineCardConfig): void {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (config.server_id !== undefined && typeof config.server_id !== "string") throw new Error("server_id must be a string");
    this._config = { ...config };
  }

  getCardSize(): number {
    return 5;
  }

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
    // Pills drift right to left with time even when no new event arrives.
    this._timer = setInterval(() => this.requestUpdate(), REFRESH_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resize?.disconnect();
    this._resize = undefined;
    clearInterval(this._timer);
    this._timer = undefined;
  }

  private _measure(): void {
    const width = Math.floor(this.renderRoot?.querySelector<HTMLElement>(".track")?.clientWidth ?? 0);
    if (width > 0 && Math.abs(width - this._width) >= 1) this._width = width;
  }

  protected updated(): void {
    this._measure();
  }

  /** HA sets `hass` on every state change anywhere; re-render only when the events (or the language) changed. */
  protected shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size !== 1 || !changed.has("hass")) return true;
    const old = changed.get("hass") as Hass | undefined;
    const sid = this._config?.server_id;
    if (!old || !this.hass || !sid) return true;
    if ((old.locale?.language ?? old.language) !== (this.hass.locale?.language ?? this.hass.language)) return true;
    const id = entityId(slug(sid), "sensor", "recent_events");
    return old.states[id] !== this.hass.states[id];
  }

  private _lang(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  render() {
    if (!this._config) return nothing;
    const lang = this._lang();
    const sid = (this._config.server_id ?? "").trim();
    if (!sid) return html`<ha-card><div class="message">${t(lang, "tl_no_server")}</div></ha-card>`;
    if (!this.hass) return html`<ha-card></ha-card>`;

    const win = windowMinutes(this._config);
    const raw = this.hass.states[entityId(sid, "sensor", "recent_events")]?.attributes?.events;
    const pills = buildPills(raw, lang, win, Date.now());
    const lanes = this._filter === "all" ? LANES : LANES.filter((l) => l === this._filter);
    const width = this._width || FALLBACK_WIDTH;

    return html`<ha-card>
      <div class="head">
        <h2>${t(lang, "tl_title")}</h2>
        <div class="chips" role="group" aria-label=${t(lang, "tl_title")}>
          ${(["all", ...LANES] as Filter[]).map(
            (f) => html`<button
              type="button"
              class="chip"
              aria-pressed=${this._filter === f ? "true" : "false"}
              @click=${() => (this._filter = f)}
            >
              ${t(lang, f === "all" ? "tl_all" : `tl_lane_${f}`)}
            </button>`,
          )}
        </div>
      </div>
      ${pills.length === 0
        ? html`<div class="message">${t(lang, "tl_empty")}</div>`
        : html`<div class="lanes">
            ${lanes.map((lane) => this._lane(lang, lane, pills.filter((p) => p.lane === lane), width))}
            ${this._axis(lang, win)}
          </div>`}
    </ha-card>`;
  }

  private _lane(lang: string, lane: Lane, pills: Pill[], width: number) {
    const boxes = pills.map((p) => ({ left: Math.min(Math.max(0, width - p.width), p.x * width), width: p.width }));
    const { rows, hidden } = stackPills(boxes, MAX_ROWS);
    const used = Math.max(1, ...rows.map((r) => r + 1));
    return html`<div class="lane" data-lane=${lane} style="height:${used * ROW_HEIGHT + 14}px">
      <div class="lane-label">
        ${t(lang, `tl_lane_${lane}`)}${hidden.length > 0 ? html` <span class="more">${t(lang, "tl_more", { count: hidden.length })}</span>` : nothing}
      </div>
      <div class="track">
        ${pills.map((p, i) =>
          rows[i] < 0
            ? nothing
            : html`<span
                class="pill ${p.tone} ${p.lane} ${p.resolved ? "resolved" : ""}"
                title=${p.title}
                style="left:${boxes[i].left}px;top:${7 + rows[i] * ROW_HEIGHT}px"
                ><i class="mark" aria-hidden="true"></i>${p.text}</span
              >`,
        )}
      </div>
    </div>`;
  }

  private _axis(lang: string, win: number) {
    return html`<div class="axis">
      <div class="lane-label"></div>
      <div class="ticks">
        ${axisTicks(win).map(
          (tick) => html`<span class="tick ${tick.minutes === 0 ? "now" : tick.x < 0.02 ? "first" : ""}" style="left:${tick.x * 100}%"
            >${tick.minutes === 0 ? t(lang, "tl_now") : t(lang, "tl_min", { n: tick.minutes })}</span
          >`,
        )}
      </div>
    </div>`;
  }

  static styles = [
    cardStyles,
    css`
      ha-card {
        display: block;
        overflow: hidden;
        background: var(--fha-bg);
        border: 1px solid var(--fha-line);
        border-radius: var(--ha-card-border-radius, 16px);
        color: var(--fha-text);
        padding: 18px 22px 14px;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px 16px;
        margin-bottom: 14px;
      }
      h2 {
        margin: 0;
        font: 600 22px "Unbounded", system-ui, sans-serif;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        font: 500 13px "Golos Text", system-ui, sans-serif;
        color: var(--fha-text);
        background: transparent;
        border: 1px solid var(--fha-line);
        border-radius: 999px;
        padding: 6px 14px;
        cursor: pointer;
      }
      .chip:hover {
        border-color: var(--fha-faint);
      }
      .chip:focus-visible {
        outline: 2px solid var(--fha-cyan);
        outline-offset: 2px;
      }
      .chip[aria-pressed="true"] {
        background: var(--fha-cyan);
        border-color: var(--fha-cyan);
        color: var(--fha-bg);
        font-weight: 600;
      }
      .message {
        padding: 18px 0 8px;
        color: var(--fha-muted);
      }
      .lane,
      .axis {
        display: grid;
        grid-template-columns: 130px 1fr;
      }
      .lane {
        border-top: 1px solid var(--fha-line);
      }
      .lane-label {
        padding-top: 14px;
        font-size: 13px;
        color: var(--fha-soft);
      }
      .more {
        color: var(--fha-muted);
        font-size: 11px;
      }
      .track {
        position: relative;
      }
      .pill {
        position: absolute;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 24px;
        padding: 0 11px 0 9px;
        box-sizing: border-box;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        color: var(--tone);
        background: color-mix(in srgb, var(--tone) 14%, var(--fha-bg));
        border: 1px solid color-mix(in srgb, var(--tone) 35%, var(--fha-bg));
      }
      .pill.red {
        --tone: var(--fha-red-soft);
        --mark: var(--fha-red);
      }
      .pill.amber {
        --tone: var(--fha-amber-soft);
        --mark: var(--fha-amber);
      }
      .pill.green {
        --tone: var(--fha-green);
        --mark: var(--fha-green);
      }
      .pill.cyan {
        --tone: var(--fha-cyan-soft);
        --mark: var(--fha-cyan);
      }
      /* Second channel besides colour: the marker shape tells the lane (triangle, diamond, dot). */
      .mark {
        flex: none;
        width: 9px;
        height: 9px;
        background: var(--mark);
        border-radius: 50%;
      }
      .pill.attacks .mark {
        border-radius: 0;
        clip-path: polygon(50% 0, 100% 100%, 0 100%);
      }
      .pill.defense .mark {
        border-radius: 1px;
        transform: rotate(45deg) scale(0.85);
      }
      .pill.resolved .mark {
        background: transparent;
        box-shadow: inset 0 0 0 2px var(--mark);
      }
      .pill.attacks.resolved .mark {
        background: var(--mark);
        opacity: 0.45;
        box-shadow: none;
      }
      .axis {
        border-top: 1px solid var(--fha-line);
      }
      .ticks {
        position: relative;
        height: 30px;
      }
      .tick {
        position: absolute;
        top: 9px;
        font-size: 12px;
        color: var(--fha-muted);
        transform: translateX(-50%);
        white-space: nowrap;
      }
      .tick.first {
        transform: none;
      }
      .tick.now {
        transform: translateX(-100%);
      }
    `,
  ];
}
