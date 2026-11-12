// @vitest-environment happy-dom
import { expect, it } from "vitest";

it("registers both stub cards as custom elements and in the card picker", async () => {
  await import("../src/index");
  for (const type of ["factorio-map-card", "factorio-timeline-card"]) {
    expect(customElements.get(type)).toBeDefined();
    expect(window.customCards?.some((c) => c.type === type)).toBe(true);
  }
  expect(window.customCards?.map((c) => c.name)).toEqual(["Factorio system map", "Factorio last hour"]);
});
