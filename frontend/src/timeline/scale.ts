/** Pure helpers of the timeline card: the logarithmic time axis, lanes and pill stacking. */

export type Lane = "attacks" | "defense" | "lines" | "platforms" | "players_science";

export const LANES: readonly Lane[] = ["attacks", "defense", "lines", "platforms", "players_science"];

/**
 * Horizontal position (0 = oldest edge of the window, 1 = now) of an event that happened
 * `minutesAgo` minutes ago: `1 - ln(1 + t) / ln(1 + w)`, so recent events get more room.
 */
export function logX(minutesAgo: number, windowMinutes: number): number {
  const x = 1 - Math.log(1 + Math.max(0, minutesAgo)) / Math.log(1 + windowMinutes);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

export function laneOf(event: string): Lane | null {
  if (event.startsWith("attack_")) return "attacks";
  if (event.startsWith("turrets_")) return "defense";
  if (event.startsWith("line_") || event === "drills_depleted") return "lines";
  if (event.startsWith("platform_")) return "platforms";
  if (event.startsWith("player_") || event === "research_finished") return "players_science";
  return null;
}

const TICKS = [60, 30, 10, 5, 2, 1];

/** Axis marks, oldest first, ending with 0 ("now"); a window shorter than 60 min gets its own edge mark. */
export function axisTicks(windowMinutes: number): { minutes: number; x: number }[] {
  const inside = TICKS.filter((m) => m < windowMinutes);
  return [windowMinutes, ...inside, 0].map((minutes) => ({ minutes, x: logX(minutes, windowMinutes) }));
}

export interface Box {
  left: number;
  width: number;
}

/**
 * Greedy row assignment: a pill goes to the first row where it does not touch the previous one.
 * Returns a row per input (`-1` = does not fit in `maxRows`) and the indexes of the hidden ones.
 */
export function stackPills(boxes: Box[], maxRows: number, gap = 6): { rows: number[]; hidden: number[] } {
  const rows = new Array<number>(boxes.length).fill(-1);
  const ends: number[] = [];
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].left - boxes[b].left || a - b);
  for (const i of order) {
    const row = ends.findIndex((end) => end + gap <= boxes[i].left);
    const at = row >= 0 ? row : ends.length < maxRows ? ends.length : -1;
    if (at < 0) continue;
    ends[at] = boxes[i].left + boxes[i].width;
    rows[i] = at;
  }
  return { rows, hidden: rows.flatMap((r, i) => (r < 0 ? [i] : [])) };
}
