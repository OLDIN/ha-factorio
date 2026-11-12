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

class FactorioSpaceCard extends FactorioStubCard {
  protected heading = "Factorio space (coming soon)";
}
class FactorioDefenseCard extends FactorioStubCard {
  protected heading = "Factorio defense (coming soon)";
}

const CARDS = [
  { type: "factorio-space-card", ctor: FactorioSpaceCard, name: "Factorio space", description: "Planets and research of a Factorio server" },
  { type: "factorio-defense-card", ctor: FactorioDefenseCard, name: "Factorio defense", description: "Attacks, turrets and evolution of a Factorio server" },
];

window.customCards = window.customCards ?? [];
for (const { type, ctor, name, description } of CARDS) {
  if (!customElements.get(type)) customElements.define(type, ctor);
  if (!window.customCards.some((c) => c.type === type)) window.customCards.push({ type, name, description });
}
