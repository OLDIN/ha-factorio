import { LitElement, html, nothing } from "lit";
import { t } from "../shared/i18n";
import type { Hass } from "../shared/types";
import { DEFAULT_WINDOW, MAX_WINDOW, MIN_WINDOW, type TimelineCardConfig } from "./config";

const SCHEMA = [
  { name: "server_id", required: true, selector: { text: {} } },
  { name: "window_minutes", selector: { number: { min: MIN_WINDOW, max: MAX_WINDOW, step: 5, mode: "box", unit_of_measurement: "min" } } },
] as const;

/** Visual editor of the timeline card: Home Assistant's own `ha-form`. */
export class FactorioTimelineCardEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
  };

  declare hass?: Hass;
  declare _config?: TimelineCardConfig;

  setConfig(config: TimelineCardConfig): void {
    this._config = config;
  }

  private _lang(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _label = (field: { name: string }): string => t(this._lang(), `editor_${field.name}`);

  private _changed(ev: CustomEvent<{ value: Partial<TimelineCardConfig> }>): void {
    ev.stopPropagation();
    const config = { ...this._config, ...ev.detail.value } as TimelineCardConfig;
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  render() {
    if (!this._config) return nothing;
    const data = { window_minutes: DEFAULT_WINDOW, ...this._config };
    return html`<ha-form
      .hass=${this.hass}
      .data=${data}
      .schema=${SCHEMA}
      .computeLabel=${this._label}
      @value-changed=${this._changed}
    ></ha-form>`;
  }
}

if (!customElements.get("factorio-timeline-card-editor"))
  customElements.define("factorio-timeline-card-editor", FactorioTimelineCardEditor);
