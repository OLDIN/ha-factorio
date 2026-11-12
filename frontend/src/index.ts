import { FactorioMapCard } from "./map/factorio-map-card";
import { FactorioTimelineCard } from "./timeline/factorio-timeline-card";

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

const CARDS = [
  { type: "factorio-map-card", ctor: FactorioMapCard, name: "Factorio system map", description: "Planets, research and defense of a Factorio server on a system map", preview: true },
  { type: "factorio-timeline-card", ctor: FactorioTimelineCard, name: "Factorio last hour", description: "Timeline of the last hour on a Factorio server", preview: false },
];

window.customCards = window.customCards ?? [];
for (const { type, ctor, name, description, preview } of CARDS) {
  if (!customElements.get(type)) customElements.define(type, ctor);
  if (!window.customCards.some((c) => c.type === type)) window.customCards.push({ type, name, description, preview });
}
