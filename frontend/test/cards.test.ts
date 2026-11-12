// @vitest-environment happy-dom
import { expect, it } from "vitest";

it("registers every card as a custom element and in the card picker", async () => {
  await import("../src/index");
  const types = ["factorio-header-card", "factorio-map-card", "factorio-planets-card", "factorio-players-card", "factorio-timeline-card"];
  for (const type of types) {
    expect(customElements.get(type)).toBeDefined();
    expect(window.customCards?.some((c) => c.type === type)).toBe(true);
  }
  expect(window.customCards?.map((c) => c.name)).toEqual([
    "Factorio header",
    "Factorio system map",
    "Factorio planets",
    "Factorio players",
    "Factorio last hour",
  ]);
});
