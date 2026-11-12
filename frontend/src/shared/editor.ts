import { LitElement, html, nothing } from "lit";
import { t } from "./i18n";
import { langOf } from "./hass";
import type { Hass } from "./types";

interface Config {
  server_id?: string;
  [key: string]: unknown;
}

const SERVER_FIELD = { name: "server_id", required: true, selector: { text: {} } } as const;

/** A visual editor (Home Assistant's own `ha-form`) for cards configured by `server_id` and `extra` fields. */
export function defineEditor(tag: string, extra: readonly Record<string, unknown>[] = []): void {
  if (customElements.get(tag)) return;
  const schema = [SERVER_FIELD, ...extra];
  class Editor extends LitElement {
    static properties = { hass: { attribute: false }, _config: { state: true } };
    declare hass?: Hass;
    declare _config?: Config;

    setConfig(config: Config): void {
      this._config = config;
    }

    private _label = (field: { name: string }): string => t(langOf(this.hass), `editor_${field.name}`);

    private _changed(ev: CustomEvent<{ value: Partial<Config> }>): void {
      ev.stopPropagation();
      const config = { ...this._config, ...ev.detail.value };
      this._config = config;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
    }

    render() {
      if (!this._config) return nothing;
      return html`<ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${schema}
        .computeLabel=${this._label}
        @value-changed=${this._changed}
      ></ha-form>`;
    }
  }
  customElements.define(tag, Editor);
}
