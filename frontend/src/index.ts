import { LitElement, html } from "lit";
import { cardStyles, ensureFonts } from "./shared/theme";
import { FactorioMapCard } from "./map/factorio-map-card";

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}

// Stub: the real timeline card arrives in the next task.
class FactorioStubCard extends LitElement {
  static styles = cardStyles;
  protected heading = "Factorio";
  setConfig(): void {}
  getCardSize(): number {
    return 2;
  }
  connectedCallback(): void {
    super.connectedCallback();
    ensureFonts();
  }
  render() {
    return html`<ha-card><div style="padding:16px">${this.heading}</div></ha-card>`;
  }
}

class FactorioTimelineCard extends FactorioStubCard {
  protected heading = "Factorio last hour (coming soon)";
}

const CARDS = [
  { type: "factorio-map-card", ctor: FactorioMapCard, name: "Factorio system map", description: "Planets, research and defense of a Factorio server on a system map", preview: true },
  { type: "factorio-timeline-card", ctor: FactorioTimelineCard, name: "Factorio last hour", description: "Timeline of the last hour on a Factorio server", preview: false },
];

window.customCards = window.customCards ?? [];
for (const { type, ctor, name, description, preview } of CARDS) {
  if (!customElements.get(type)) customElements.define(type, ctor);
  if (!window.customCards.some((c) => c.type === type)) window.customCards.push({ type, name, description, preview });
}
