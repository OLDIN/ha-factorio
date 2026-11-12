import { describe, expect, it } from "vitest";
import { drillText, lineText, readLines } from "../src/shared/production";
import type { HassState } from "../src/shared/types";

const linesState = (lines: unknown[]): Record<string, HassState> => ({
  "sensor.factorio_main_fulgora_problem_lines": { state: String(lines.length), attributes: { lines } } as HassState,
});

describe("production texts", () => {
  it("drops a reason it does not know instead of showing a raw key", () => {
    const [line] = readLines(linesState([{ recipe: "scrap-recycling", reason: "frozen_solid", stopped: 3, total: 9, minutes: 4 }]), "main", "fulgora")!;
    expect(lineText(line, "uk")).toBe("Scrap recycling: стоїть 3 з 9, 4 хв");
  });
  it("never says more machines stopped than there are", () => {
    const [line] = readLines(linesState([{ recipe: "iron-plate", reason: "no_input", stopped: 12, total: 9, minutes: 2 }]), "main", "fulgora")!;
    expect(line.stopped).toBe(9);
  });
  it("names drills depleted before the first scan as an unknown resource", () => {
    expect(drillText({ resource: "unknown", depleted: 3, total: 3 }, "uk")).toBe("Невідомий ресурс: вичерпано 3 з 3 бурів");
    expect(drillText({ resource: "unknown", depleted: 1, total: 1 }, "en")).toBe("Unknown resource: 1 of 1 drill depleted");
  });
});
