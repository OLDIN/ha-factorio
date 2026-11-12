import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { defineEditor } from "../shared/editor";
import { findServer, langOf, serverChanged } from "../shared/hass";
import { t, tn } from "../shared/i18n";
import { bodyName } from "../shared/names";
import { cardStyles, ensureFonts, panelStyles } from "../shared/theme";
import type { Hass } from "../shared/types";
import { playersModel } from "./model";

interface PlayersCardConfig {
  type?: string;
  server_id: string;
}

const EDITOR = "factorio-players-card-editor";
defineEditor(EDITOR);

/** The "Players" block of the AB-1 dashboard: who is online, AFK, deaths of the last hour. */
export class FactorioPlayersCard extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true } };

  declare hass?: Hass;
  declare _config?: PlayersCardConfig;

  private _timer?: ReturnType<typeof setInterval>;

  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR);
  }

  static getStubConfig(hass?: Hass): PlayersCardConfig {
    return { server_id: findServer(hass, "players_online") };
  }

  setConfig(config: PlayersCardConfig): void {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (config.server_id !== undefined && typeof config.server_id !== "string") throw new Error("server_id must be a string");
    this._config = { ...config };
  }

  getCardSize(): number {
    return 3;
  }

  getGridOptions(): { columns: "full"; min_columns: number } {
    return { columns: "full", min_columns: 3 };
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureFonts();
    // "N min ago" and the one-hour window move with time.
    this._timer = setInterval(() => this.requestUpdate(), 60_000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this._timer);
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
    const m = playersModel(this.hass.states, sid, Date.now());
    const deaths = m.deaths
      .slice(0, 3)
      .map((d) => (d.planet ? t(lang, "pp_death", { player: d.player, planet: bodyName(d.planet, lang) }) : d.player))
      .join(", ");
    return html`<ha-card>
      <div class="head">
        <h2>${t(lang, "pp_title")}</h2>
        <span class="count">${m.online.length}</span>
      </div>
      <div class="list">
        ${m.online.length === 0
          ? html`<div class="nobody">${t(lang, "pp_nobody")}</div>`
          : m.online.map(
              (p) => html`<div class="player ${p.afk > 0 ? "afk" : ""}">
                <span class="who"><i class="dot"></i>${p.name}</span>
                <span class="status">${p.afk > 0 ? t(lang, "pp_afk", { minutes: p.afk }) : t(lang, "pp_in_game")}</span>
              </div>`,
            )}
        ${m.lastLeft
          ? html`<div class="foot">${t(lang, "tl_left", { player: m.lastLeft.player })}, ${m.lastLeft.minutes < 1
              ? t(lang, "tl_ago_now")
              : t(lang, "tl_ago", { minutes: m.lastLeft.minutes })}</div>`
          : nothing}
        ${m.deaths.length > 0 ? html`<div class="foot">${tn(lang, "pp_deaths", m.deaths.length, { list: deaths })}</div>` : nothing}
      </div>
    </ha-card>`;
  }

  static styles = [
    cardStyles,
    panelStyles,
    css`
      ha-card {
        gap: 4px;
      }
      .head {
        justify-content: flex-start;
        gap: 10px;
        padding-bottom: 8px;
      }
      .count {
        font: 500 16px "Unbounded", system-ui, sans-serif;
        color: var(--fha-muted);
      }
      .player,
      .nobody,
      .foot {
        padding: 10px 0;
        border-top: 1px solid var(--fha-line);
      }
      .player {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
      }
      .who {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .dot {
        flex: none;
        width: 8px;
        height: 8px;
        box-sizing: border-box;
        border-radius: 50%;
        background: var(--fha-green-soft);
      }
      .afk .dot {
        background: transparent;
        border: 1.5px solid var(--fha-muted);
      }
      .status,
      .nobody,
      .foot {
        font-size: 13px;
        color: var(--fha-muted);
      }
      .status {
        white-space: nowrap;
      }
      .foot {
        padding-bottom: 0;
      }
    `,
  ];
}
