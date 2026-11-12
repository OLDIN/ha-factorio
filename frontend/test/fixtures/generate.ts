import type { Body } from "../../src/map/layout";

/** Small deterministic PRNG (mulberry32): the same seed always gives the same bodies. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES = ["ka", "lo", "ver", "nis", "tra", "mo", "rex", "ul", "pha", "zen", "do", "ri", "quo", "sel", "an", "bry"];
const LONG_NAMES = ["solar-system-edge", "shattered-planet", "secretas-outpost", "frozen-asteroid-belt"];

/**
 * A big modpack-like system: about a fifth of the bodies are moons (one parent has 3+ moons),
 * distances 5–80 in steps of 0.5 (so some ties), a few long names.
 */
export function generateBodies(count: number, seed = 42): Body[] {
  const rnd = mulberry32(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)];
  const names = new Set<string>();
  const name = (i: number): string => {
    if (i < LONG_NAMES.length) return LONG_NAMES[i];
    for (;;) {
      const parts = 2 + Math.floor(rnd() * 3);
      let text = "";
      for (let k = 0; k < parts; k++) text += pick(SYLLABLES);
      if (!names.has(text)) return text;
    }
  };
  const states = ["built", "built", "unlocked", "locked"] as const;
  const moons = Math.max(1, Math.round(count / 5));
  const bodies: Body[] = [];
  for (let i = 0; i < count - moons; i++) {
    const n = name(i);
    names.add(n);
    bodies.push({
      name: n,
      kind: i < 2 ? "space-location" : "planet",
      distance: 5 + Math.round(rnd() * 150) / 2,
      orientation: Math.round(rnd() * 1000) / 1000,
      magnitude: Math.round((0.5 + rnd() * 1.5) * 10) / 10,
      parent: null,
      state: pick([...states]),
      unlocked_by: null,
    });
  }
  const planets = bodies.filter((b) => b.kind === "planet");
  for (let i = 0; i < moons; i++) {
    const n = name(count + i);
    names.add(n);
    // The first three moons share one parent.
    const parent = i < 3 ? planets[0] : pick(planets);
    bodies.push({
      name: n,
      kind: "planet",
      distance: 1 + Math.round(rnd() * 10) / 10,
      orientation: Math.round(rnd() * 1000) / 1000,
      magnitude: 0.5,
      parent: parent.name,
      state: pick([...states]),
      unlocked_by: null,
    });
  }
  return bodies;
}
