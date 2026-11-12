import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import { defineEditor } from "../shared/editor";
import { findServer, langOf, serverChanged } from "../shared/hass";
import { t, tn } from "../shared/i18n";
import { bodyNameAccusative, researchName } from "../shared/names";
import { cardStyles, ensureFonts } from "../shared/theme";
import type { Hass } from "../shared/types";
import { headerModel } from "./model";

interface HeaderCardConfig {
  type?: string;
  server_id: string;
  /** Default "Factorio". */
  title?: string;
}

const EDITOR = "factorio-header-card-editor";
defineEditor(EDITOR, [{ name: "title", selector: { text: {} } }]);

const SHIELD = svg`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"></path><path d="M12 8v5"></path><path d="M12 16.5v.5"></path></svg>`;

/** The header of the AB-1 dashboard: title, game state, attack, players and the research bar. */
export class FactorioHeaderCard extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true } };

  declare hass?: Hass;
  declare _config?: HeaderCardConfig;

  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR);
  }

  static getStubConfig(hass?: Hass): HeaderCardConfig {
    return { server_id: findServer(hass, "game_state") };
  }

  setConfig(config: HeaderCardConfig): void {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (config.server_id !== undefined && typeof config.server_id !== "string") throw new Error("server_id must be a string");
    if (config.title !== undefined && typeof config.title !== "string") throw new Error("title must be a string");
    this._config = { ...config };
  }

  getCardSize(): number {
    return 2;
  }

  getGridOptions(): { columns: "full"; min_columns: number } {
    return { columns: "full", min_columns: 6 };
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
    const title = this._config.title?.trim() || "Factorio";
    if (!sid) return html`<ha-card><div class="message">${t(lang, "map_no_server")}</div></ha-card>`;
    if (!this.hass) return html`<ha-card></ha-card>`;
    const m = headerModel(this.hass.states, sid);
    const rs = m.research;
    const rsName = rs ? `${researchName(rs.name, lang)}${rs.level > 1 ? ` ${rs.level}` : ""}` : t(lang, "hd_no_research");
    return html`<ha-card>
      <div class="left">
        <h1>${title}</h1>
        ${m.game === null ? nothing : html`<span class="chip state ${m.game}"><i class="dot"></i>${t(lang, `hd_${m.game}`)}</span>`}
        ${m.attacked.length === 0
          ? nothing
          : html`<span class="chip attack">${SHIELD}${t(lang, "hd_attack", { planets: m.attacked.map((b) => bodyNameAccusative(b, lang)).join(", ") })}</span>`}
        ${m.players === null
          ? nothing
          : html`<span class="players">${m.players === 0 ? t(lang, "hd_players_none") : tn(lang, "hd_players", m.players)}</span>`}
      </div>
      <div class="research ${rs ? "" : "idle"}">
        <div class="row small">
          <span>${t(lang, "hd_researching")}</span>
          ${rs && rs.queued > 0 ? html`<span class="queue">${t(lang, "hd_queue", { count: rs.queued })}</span>` : nothing}
        </div>
        <div class="row">
          <span class="name">${rsName}</span>
          ${rs ? html`<span class="pct">${Math.round(rs.progress)}%</span>` : nothing}
        </div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${rs ? Math.round(rs.progress) : 0}>
          <i style="width:${rs ? rs.progress : 0}%"></i>
        </div>
      </div>
    </ha-card>`;
  }

  static styles = [
    cardStyles,
    css`
      /* No box: the header sits on the page, as in the mockup. */
      ha-card {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px 32px;
        padding: 4px 2px;
        background: none;
        border: none;
        box-shadow: none;
        color: var(--fha-text);
      }
      .left {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px 16px;
      }
      h1 {
        margin: 0;
        font: 600 30px "Unbounded", system-ui, sans-serif;
        letter-spacing: 0.01em;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
      }
      .state.running {
        background: var(--fha-green-bg);
        color: var(--fha-green-soft);
      }
      .state.paused {
        background: var(--fha-amber-chip);
        color: var(--fha-amber-soft);
      }
      .state.stopped {
        background: var(--fha-chip);
        color: var(--fha-muted);
      }
      .state.no_connection,
      .attack {
        background: var(--fha-red-chip);
        color: var(--fha-red-soft);
      }
      .players {
        font-size: 14px;
        color: var(--fha-muted);
      }
      .research {
        flex: 0 1 420px;
        min-width: 260px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
      }
      .small {
        font-size: 13px;
        color: var(--fha-muted);
      }
      .name {
        font: 500 15px "Unbounded", system-ui, sans-serif;
      }
      .idle .name {
        color: var(--fha-muted);
      }
      .pct {
        font-size: 17px;
        font-weight: 600;
        color: var(--fha-cyan);
        font-variant-numeric: tabular-nums;
      }
      .bar {
        height: 6px;
        border-radius: 3px;
        background: var(--fha-line);
        overflow: hidden;
      }
      .bar i {
        display: block;
        height: 100%;
        background: var(--fha-cyan);
      }
      .message {
        color: var(--fha-muted);
      }
    `,
  ];
}
