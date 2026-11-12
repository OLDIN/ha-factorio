import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { formatLosses } from "../map/callouts";
import { defineEditor } from "../shared/editor";
import { findServer, langOf, serverChanged } from "../shared/hass";
import { t } from "../shared/i18n";
import { bodyName, bodyNameNear } from "../shared/names";
import { PLATFORM_ROWS, platformTone, readPlatforms, type PlatformRow } from "../shared/platforms";
import { lineText } from "../shared/production";
import { cardStyles, ensureFonts, panelStyles } from "../shared/theme";
import type { Hass } from "../shared/types";

interface PlatformsCardConfig {
  type?: string;
  server_id: string;
}

const EDITOR = "factorio-platforms-card-editor";
defineEditor(EDITOR);

const STANDING: Record<string, string> = { parked: "pf_parked", waiting: "pf_waiting", building: "pf_building" };

/** The "Platforms" block of the dashboard: where each space platform is or flies, damage, problem lines. */
export class FactorioPlatformsCard extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true }, _open: { state: true } };

  declare hass?: Hass;
  declare _config?: PlatformsCardConfig;
  /** All platforms shown, not only the first PLATFORM_ROWS. */
  declare _open: boolean;

  constructor() {
    super();
    this._open = false;
  }

  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR);
  }

  static getStubConfig(hass?: Hass): PlatformsCardConfig {
    return { server_id: findServer(hass, "platforms") };
  }

  setConfig(config: PlatformsCardConfig): void {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (config.server_id !== undefined && typeof config.server_id !== "string") throw new Error("server_id must be a string");
    this._config = { ...config };
  }

  getCardSize(): number {
    return 4;
  }

  getGridOptions(): { columns: "full"; min_columns: number } {
    return { columns: "full", min_columns: 3 };
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureFonts();
  }

  protected shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size !== 1 || !changed.has("hass")) return true;
    const old = changed.get("hass") as Hass | undefined;
    const sid = this._config?.server_id;
    return !old || !this.hass || !sid || serverChanged(old, this.hass, sid);
  }

  render() {
    if (!this._config) return nothing;
    const lang = langOf(this.hass);
    const sid = (this._config.server_id ?? "").trim();
    if (!sid) return html`<ha-card><div class="message">${t(lang, "map_no_server")}</div></ha-card>`;
    if (!this.hass) return html`<ha-card></ha-card>`;
    const rows = readPlatforms(this.hass.states, sid) ?? [];
    const shown = this._open ? rows : rows.slice(0, PLATFORM_ROWS);
    return html`<ha-card>
      <div class="head">
        <h2>${t(lang, "pf_title")}${rows.length > 0 ? html` <span class="count">${rows.length}</span>` : nothing}</h2>
      </div>
      ${rows.length === 0
        ? html`<div class="message">${t(lang, "pf_none")}</div>`
        : html`<ul class="rows">
            ${shown.map((r) => this._row(lang, r))}
          </ul>`}
      ${rows.length > PLATFORM_ROWS
        ? html`<button class="more" aria-expanded=${this._open ? "true" : "false"} @click=${() => (this._open = !this._open)}>
            ${this._open ? t(lang, "pl_less") : t(lang, "pl_more", { count: rows.length - PLATFORM_ROWS })}
          </button>`
        : nothing}
    </ha-card>`;
  }

  private _row(lang: string, r: PlatformRow) {
    const tone = platformTone(r);
    const where =
      r.route !== null
        ? nothing
        : r.location !== null && Object.hasOwn(STANDING, r.kind)
          ? t(lang, STANDING[r.kind], { place: bodyNameNear(r.location, lang) })
          : r.kind === "flying"
            ? t(lang, "pf_flying")
            : r.location !== null
              ? bodyName(r.location, lang)
              : nothing;
    const losses = r.damage ? formatLosses(r.damage.losses, lang) : "";
    return html`<li class="row ${tone}">
      <span class="diamond ${tone}" aria-hidden="true"></span>
      <div class="main">
        <div class="top">
          <span class="name">${t(lang, "pf_name", { name: r.name })}</span>
          ${where === nothing ? nothing : html`<span class="where">${where}</span>`}
        </div>
        ${r.damage ? html`<div class="damage">${losses ? t(lang, "pf_damaged", { list: losses }) : t(lang, "pf_damaged", { list: "—" })}</div>` : nothing}
        ${r.lines.map((l) => html`<div class="line">${lineText(l, lang)}</div>`)}
        ${r.linesMore > 0 ? html`<div class="line more-lines">${t(lang, "pl_more", { count: r.linesMore })}</div>` : nothing}
        ${r.route
          ? html`<div class="route">
              <span class="end">${bodyName(r.route.from, lang)}</span>
              <span class="bar"><span class="fill" style="width:${Math.round(r.route.progress * 100)}%"></span></span>
              <span class="end">${bodyName(r.route.to, lang)}</span>
            </div>`
          : nothing}
      </div>
    </li>`;
  }

  static styles = [
    cardStyles,
    panelStyles,
    css`
      .count {
        margin-left: 6px;
        font: 500 17px "Unbounded", system-ui, sans-serif;
        color: var(--fha-muted);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .row {
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr);
        gap: 10px;
        padding: 12px 0;
        border-top: 1px solid var(--fha-line);
      }
      .row:first-child {
        padding-top: 0;
        border-top: none;
      }
      .diamond {
        width: 9px;
        height: 9px;
        margin-top: 6px;
        transform: rotate(45deg);
        background: var(--fha-faint);
      }
      .diamond.amber {
        background: var(--fha-amber);
      }
      .diamond.cyan {
        background: var(--fha-cyan);
      }
      .main {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px 12px;
        flex-wrap: wrap;
      }
      .name {
        font: 600 15px "Unbounded", system-ui, sans-serif;
      }
      .row.muted .name {
        color: var(--fha-soft);
      }
      .where {
        font-size: 13px;
        color: var(--fha-muted);
      }
      .damage,
      .line {
        font-size: 14px;
        color: var(--fha-amber-soft);
      }
      .more-lines {
        font-size: 13px;
      }
      .route {
        display: grid;
        grid-template-columns: auto minmax(40px, 1fr) auto;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        color: var(--fha-soft);
      }
      .bar {
        height: 4px;
        border-radius: 2px;
        background: var(--fha-line);
        overflow: hidden;
      }
      .fill {
        display: block;
        height: 100%;
        border-radius: 2px;
        background: var(--fha-cyan);
      }
      .row.amber .fill {
        background: var(--fha-amber);
      }
      .more {
        align-self: flex-start;
        padding: 2px 0;
        border: 0;
        background: none;
        color: var(--fha-cyan);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .more:hover {
        text-decoration: underline;
      }
    `,
  ];
}
