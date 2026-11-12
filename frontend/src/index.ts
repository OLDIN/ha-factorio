import { FactorioHeaderCard } from "./header/factorio-header-card";
import { FactorioMapCard } from "./map/factorio-map-card";
import { FactorioPlanetsCard } from "./planets/factorio-planets-card";
import { FactorioPlayersCard } from "./players/factorio-players-card";
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
  { type: "factorio-header-card", ctor: FactorioHeaderCard, name: "Factorio header", description: "Game state, attacks, players and research of a Factorio server", preview: true },
  { type: "factorio-map-card", ctor: FactorioMapCard, name: "Factorio system map", description: "Planets, research and defense of a Factorio server on a system map", preview: true },
  { type: "factorio-planets-card", ctor: FactorioPlanetsCard, name: "Factorio planets", description: "Planets of a Factorio server: the ones needing attention first", preview: true },
  { type: "factorio-players-card", ctor: FactorioPlayersCard, name: "Factorio players", description: "Who is online on a Factorio server, AFK and deaths", preview: true },
  { type: "factorio-timeline-card", ctor: FactorioTimelineCard, name: "Factorio last hour", description: "Timeline of the last hour on a Factorio server", preview: false },
];

window.customCards = window.customCards ?? [];
for (const { type, ctor, name, description, preview } of CARDS) {
  if (!customElements.get(type)) customElements.define(type, ctor);
  if (!window.customCards.some((c) => c.type === type)) window.customCards.push({ type, name, description, preview });
}
