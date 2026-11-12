import { LitElement, html, nothing } from "lit";
import { t } from "../shared/i18n";
import type { Hass } from "../shared/types";
import { DEFAULT_HEIGHT, MAX_HEIGHT, MIN_HEIGHT, type MapCardConfig } from "./config";

const SCHEMA = [
  { name: "server_id", required: true, selector: { text: {} } },
  {
    name: "height",
    selector: { number: { min: MIN_HEIGHT, max: MAX_HEIGHT, step: 20, mode: "slider", unit_of_measurement: "px" } },
  },
  { name: "label_healthy", selector: { boolean: {} } },
] as const;

/** Visual editor of the map card: Home Assistant's own `ha-form`. */
export class FactorioMapCardEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
  };

  declare hass?: Hass;
  declare _config?: MapCardConfig;

  setConfig(config: MapCardConfig): void {
    this._config = config;
  }

  private _lang(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _label = (field: { name: string }): string => t(this._lang(), `editor_${field.name}`);

  private _changed(ev: CustomEvent<{ value: Partial<MapCardConfig> }>): void {
    ev.stopPropagation();
    const config = { ...this._config, ...ev.detail.value } as MapCardConfig;
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  render() {
    if (!this._config) return nothing;
    const data = { height: DEFAULT_HEIGHT, label_healthy: true, ...this._config };
    return html`<ha-form
      .hass=${this.hass}
      .data=${data}
      .schema=${SCHEMA}
      .computeLabel=${this._label}
      @value-changed=${this._changed}
    ></ha-form>`;
  }
}

if (!customElements.get("factorio-map-card-editor")) customElements.define("factorio-map-card-editor", FactorioMapCardEditor);
