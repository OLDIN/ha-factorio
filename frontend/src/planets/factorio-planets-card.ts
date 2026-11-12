import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { defineEditor } from "../shared/editor";
import { findServer, langOf, serverChanged } from "../shared/hass";
import { t } from "../shared/i18n";
import { bodyName } from "../shared/names";
import { planetColor } from "../shared/palette";
import { cardStyles, ensureFonts, panelStyles } from "../shared/theme";
import type { Hass } from "../shared/types";
import { planetsModel, type PlanetRow } from "./model";

interface PlanetsCardConfig {
  type?: string;
  server_id: string;
}

const EDITOR = "factorio-planets-card-editor";
defineEditor(EDITOR);

const pct = (n: number): string => `${Math.round(n)}%`;

/** The "Planets" block of the AB-1 dashboard: planets that need attention, then the rest. */
export class FactorioPlanetsCard extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true } };

  declare hass?: Hass;
  declare _config?: PlanetsCardConfig;

  private _timer?: ReturnType<typeof setInterval>;
  private _hasAttack = false;

  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR);
  }

  static getStubConfig(hass?: Hass): PlanetsCardConfig {
    return { server_id: findServer(hass, "bodies") };
  }

  setConfig(config: PlanetsCardConfig): void {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    if (config.server_id !== undefined && typeof config.server_id !== "string") throw new Error("server_id must be a string");
    this._config = { ...config };
  }

  getCardSize(): number {
    return 6;
  }

  getGridOptions(): { columns: "full"; min_columns: number } {
    return { columns: "full", min_columns: 6 };
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureFonts();
    // Keeps "attack for N min" current.
    this._timer = setInterval(() => {
      if (this._hasAttack) this.requestUpdate();
    }, 30_000);
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
    const m = planetsModel(this.hass.states, sid, lang, Date.now());
    this._hasAttack = m.attention.some((r) => r.tone === "red");
    const name = (id: string): string => bodyName(id, lang);
    return html`<ha-card>
      <div class="head">
        <h2>${t(lang, "pl_title")}</h2>
        ${m.attention.length > 0 ? html`<span class="hint">${t(lang, "pl_hint")}</span>` : nothing}
      </div>
      ${m.total === 0
        ? html`<div class="message">${t(lang, "map_no_bodies")}</div>`
        : html`${m.attention.length > 0
              ? html`<div class="rows">${m.attention.map((r) => this._row(lang, r))}</div>`
              : html`<div class="calm">${t(lang, "pl_calm")}</div>`}
            ${m.healthy.length > 0
              ? html`<div class="group healthy">
                  <div class="sub">
                    <h3>${t(lang, "pl_healthy")}</h3>
                    <span class="count">${m.healthy.length}</span>
                    ${m.healthy.some((r) => r.evolution !== null) ? html`<span class="hint">${t(lang, "pl_healthy_hint")}</span>` : nothing}
                  </div>
                  <ul class="grid">
                    ${m.healthy.map(
                      (r) => html`<li>
                        <span class="dot" style="background:${planetColor(r.name)}"></span><span class="nm">${name(r.name)}</span
                        >${r.evolution === null ? nothing : html`<span class="num" title=${t(lang, "pl_evolution")}>${pct(r.evolution)}</span>`}
                      </li>`,
                    )}
                  </ul>
                </div>`
              : nothing}
            ${m.unlocked.length + m.locked.length > 0
              ? html`<div class="group split">
                  ${m.unlocked.length > 0
                    ? html`<div class="col unlocked">
                        <div class="sub"><h3>${t(lang, "pl_unlocked")}</h3><span class="count muted">${m.unlocked.length}</span></div>
                        <ul class="flow">
                          ${m.unlocked.map(
                            (n) => html`<li><span class="ring" style="border-color:${planetColor(n)}"></span>${name(n)}</li>`,
                          )}
                        </ul>
                      </div>`
                    : nothing}
                  ${m.locked.length > 0
                    ? html`<div class="col locked">
                        <div class="sub"><h3>${t(lang, "pl_locked")}</h3><span class="count muted">${m.locked.length}</span></div>
                        <ul class="flow">
                          ${m.locked.map(
                            (l) =>
                              html`<li class=${l.progress === null ? "" : "research"}>
                                ${name(l.name)}${l.progress === null ? nothing : html`<span class="num">${pct(l.progress)}</span>`}
                              </li>`,
                          )}
                        </ul>
                      </div>`
                    : nothing}
                </div>`
              : nothing}`}
    </ha-card>`;
  }

  private _row(lang: string, r: PlanetRow) {
    return html`<div class="row ${r.tone}">
      <div class="badge"><span class="sphere" style="background-color:${planetColor(r.name)}"></span></div>
      <div class="body">
        <span class="name">${bodyName(r.name, lang)}</span>
        ${r.lines.map((l) => html`<span class="line ${l.tone}">${l.text}</span>`)}
      </div>
      <div class="evo">
        ${r.evolution === null ? html`<b class="none">—</b>` : html`<b>${pct(r.evolution)}</b>`}<span>${t(lang, "pl_evolution")}</span>
      </div>
    </div>`;
  }

  static styles = [
    cardStyles,
    panelStyles,
    css`
      .rows {
        display: flex;
        flex-direction: column;
      }
      .row {
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr) auto;
        gap: 6px 16px;
        align-items: start;
        padding: 16px 0;
        border-top: 1px solid var(--fha-line);
      }
      .row:first-child {
        padding-top: 4px;
        border-top: none;
      }
      .row:last-child {
        padding-bottom: 4px;
      }
      .row.red {
        --tone: var(--fha-red);
      }
      .row.amber {
        --tone: var(--fha-amber);
      }
      /* Stage 2a: the ring has no share of working machines yet, it only carries the alert colour. */
      .badge {
        width: 52px;
        height: 52px;
        box-sizing: border-box;
        border-radius: 50%;
        border: 5px solid var(--tone);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .sphere {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background-image: radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.28), rgb(255 255 255 / 0) 50%, rgb(0 0 0 / 0.45) 100%);
      }
      .body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .name {
        font: 600 16px "Unbounded", system-ui, sans-serif;
      }
      .line {
        font-size: 14px;
      }
      .line.red {
        color: var(--fha-red-soft);
      }
      .line.amber {
        color: var(--fha-amber-soft);
      }
      .evo {
        text-align: right;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .evo b {
        font-size: 17px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .evo b.none {
        color: var(--fha-faint);
      }
      .evo span {
        font-size: 12px;
        color: var(--fha-muted);
      }
      .calm {
        font-size: 14px;
        color: var(--fha-green-soft);
      }
      .group {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 16px;
        border-top: 1px solid var(--fha-line);
      }
      .group.split {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 16px 40px;
      }
      .col {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1 1 300px;
      }
      .sub {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      h3 {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
      }
      .count {
        font: 500 14px "Unbounded", system-ui, sans-serif;
        color: var(--fha-green-soft);
      }
      .sub .hint {
        margin-left: auto;
      }
      .count.muted {
        color: var(--fha-muted);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
        gap: 8px;
      }
      .grid li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--fha-chip);
        font-size: 14px;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex: none;
      }
      .nm {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .num {
        color: var(--fha-muted);
        font-variant-numeric: tabular-nums;
      }
      .flow {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .flow li {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid var(--fha-line);
        font-size: 14px;
        color: var(--fha-soft);
      }
      .ring {
        width: 9px;
        height: 9px;
        box-sizing: border-box;
        border-radius: 50%;
        border: 1.5px solid;
        flex: none;
      }
      .locked li {
        border-style: dashed;
        border-color: var(--fha-dash);
        color: var(--fha-muted);
      }
      .locked li.research {
        color: var(--fha-cyan-soft);
      }
      .locked li.research .num {
        color: var(--fha-cyan);
      }
    `,
  ];
}
