import { LitElement, html } from "lit";
import { cardStyles, ensureFonts } from "./shared/theme";

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}

// Stubs: the real cards arrive in the next tasks.
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

class FactorioMapCard extends FactorioStubCard {
  protected heading = "Factorio system map (coming soon)";
}
class FactorioTimelineCard extends FactorioStubCard {
  protected heading = "Factorio last hour (coming soon)";
}

const CARDS = [
  { type: "factorio-map-card", ctor: FactorioMapCard, name: "Factorio system map", description: "Planets, research and defense of a Factorio server on a system map" },
  { type: "factorio-timeline-card", ctor: FactorioTimelineCard, name: "Factorio last hour", description: "Timeline of the last hour on a Factorio server" },
];

window.customCards = window.customCards ?? [];
for (const { type, ctor, name, description } of CARDS) {
  if (!customElements.get(type)) customElements.define(type, ctor);
  if (!window.customCards.some((c) => c.type === type)) window.customCards.push({ type, name, description });
}
