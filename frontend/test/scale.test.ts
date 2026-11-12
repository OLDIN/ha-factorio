import { describe, expect, it } from "vitest";
import { LANES, axisTicks, laneOf, logX, stackPills } from "../src/timeline/scale";

describe("logX", () => {
  it("gives recent events more room", () => {
    expect(logX(2, 60)).toBeCloseTo(0.733, 3);
  });
  it("puts now at 1 and the window edge at 0", () => {
    expect(logX(0, 60)).toBe(1);
    expect(logX(60, 60)).toBe(0);
  });
  it("clamps to [0, 1]", () => {
    expect(logX(90, 60)).toBe(0);
    expect(logX(-5, 60)).toBe(1);
  });
  it("is monotonic", () => {
    expect(logX(1, 60)).toBeGreaterThan(logX(5, 60));
    expect(logX(5, 60)).toBeGreaterThan(logX(30, 60));
  });
});

describe("laneOf", () => {
  it("maps events to lanes", () => {
    expect(laneOf("attack_started")).toBe("attacks");
    expect(laneOf("attack_ended")).toBe("attacks");
    expect(laneOf("turrets_no_ammo")).toBe("defense");
    expect(laneOf("turrets_ok")).toBe("defense");
    expect(laneOf("player_joined")).toBe("players_science");
    expect(laneOf("player_died")).toBe("players_science");
    expect(laneOf("research_finished")).toBe("players_science");
    expect(laneOf("line_problem")).toBe("lines");
    expect(laneOf("line_recovered")).toBe("lines");
    expect(laneOf("drills_depleted")).toBe("lines");
  });
  it("returns null for unknown events", () => {
    expect(laneOf("unknown")).toBeNull();
    expect(laneOf("")).toBeNull();
  });
});

describe("LANES", () => {
  it("orders attacks, defense, lines and drills, platforms, players and science", () => {
    expect(LANES).toEqual(["attacks", "defense", "lines", "platforms", "players_science"]);
    for (const e of ["platform_departed", "platform_arrived", "platform_damaged"]) expect(laneOf(e)).toBe("platforms");
  });
});

describe("axisTicks", () => {
  it("is 60, 30, 10, 5, 2, 1 and now for the default window", () => {
    expect(axisTicks(60).map((t) => t.minutes)).toEqual([60, 30, 10, 5, 2, 1, 0]);
  });
  it("keeps only ticks inside a shorter window and adds the edge", () => {
    expect(axisTicks(20).map((t) => t.minutes)).toEqual([20, 10, 5, 2, 1, 0]);
  });
});

describe("stackPills", () => {
  it("keeps apart pills on separate rows when they collide", () => {
    const { rows, hidden } = stackPills([{ left: 0, width: 100 }, { left: 50, width: 100 }, { left: 200, width: 50 }], 3);
    expect(rows).toEqual([0, 1, 0]);
    expect(hidden).toEqual([]);
  });
  it("hides what does not fit in the row cap", () => {
    const { rows, hidden } = stackPills([{ left: 0, width: 100 }, { left: 10, width: 100 }, { left: 20, width: 100 }], 2);
    expect(rows).toEqual([0, 1, -1]);
    expect(hidden).toEqual([2]);
  });
  it("is independent of input order", () => {
    const { rows } = stackPills([{ left: 50, width: 100 }, { left: 0, width: 100 }], 3);
    expect(rows).toEqual([1, 0]);
  });
});
