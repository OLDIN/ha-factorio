/** Readers of the per-planet production sensors (machines, problem lines, depleted drills). Pure. */
import { entityId } from "./entities";
import { t, tn } from "./i18n";
import { prettyName } from "./names";
import { asDict, asList, type HassState } from "./types";

type States = Record<string, HassState | undefined>;

/** Stop reasons the integration reports; anything else is shown without a reason. */
const REASONS = new Set(["no_input", "output_full", "no_power"]);

export interface Machines {
  total: number;
  working: number;
}

export interface ProblemLine {
  recipe: string;
  /** The dominant bucket: no_input, output_full or no_power. */
  reason: string;
  stopped: number;
  total: number;
  /** How long the line has been in trouble, whole minutes. */
  minutes: number;
}

export interface DepletedDrills {
  resource: string;
  depleted: number;
  total: number;
}

const IDLE = new Set(["unknown", "unavailable", ""]);

/** The sensor when it has a value, null when missing, unknown or unavailable. */
function known(states: States, sid: string, key: string, planet: string): HassState | null {
  const state = states[entityId(sid, "sensor", key, planet)];
  return state && !IDLE.has(state.state) ? state : null;
}

function whole(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Working / total machines of a planet; null without data or with no machines. */
export function readMachines(states: States, sid: string, planet: string): Machines | null {
  const state = known(states, sid, "machines_working", planet);
  if (!state) return null;
  const attrs = asDict(state.attributes);
  const total = whole(attrs.total);
  return total > 0 ? { total, working: Math.min(total, whole(attrs.working)) } : null;
}

/** Lines in trouble, worst first as the sensor sorts them; null without data. */
export function readLines(states: States, sid: string, planet: string): ProblemLine[] | null {
  const state = known(states, sid, "problem_lines", planet);
  if (!state) return null;
  const lines: ProblemLine[] = [];
  for (const raw of asList(asDict(state.attributes).lines)) {
    const line = asDict(raw);
    if (typeof line.recipe !== "string" || line.recipe === "") continue;
    const total = whole(line.total);
    if (total === 0) continue;
    lines.push({
      recipe: line.recipe,
      reason: typeof line.reason === "string" && REASONS.has(line.reason) ? line.reason : "",
      stopped: Math.min(whole(line.stopped), total),
      total,
      minutes: whole(line.minutes),
    });
  }
  return lines;
}

/** Resources with depleted drills, in the sensor's order; null without data. */
export function readDrills(states: States, sid: string, planet: string): DepletedDrills[] | null {
  const state = known(states, sid, "drills_depleted", planet);
  if (!state) return null;
  const out: DepletedDrills[] = [];
  for (const [resource, raw] of Object.entries(asDict(asDict(state.attributes).by_resource))) {
    const stats = asDict(raw);
    const depleted = whole(stats.depleted);
    if (depleted > 0) out.push({ resource, depleted, total: Math.max(depleted, whole(stats.total)) });
  }
  return out;
}

/** "Scrap recycling: 31 of 48 stopped, output full, 11 min" — one problem line as a row of text. */
export function lineText(line: ProblemLine, lang: string): string {
  const reason = line.reason === "" ? "" : `, ${t(lang, `reason_${line.reason}`)}`;
  const minutes = line.minutes < 1 ? "<1" : line.minutes;
  return t(lang, "pl_line", { recipe: prettyName(line.recipe), stopped: line.stopped, total: line.total, reason, minutes });
}

/** "Iron ore: 3 of 12 drills depleted" — one resource with depleted drills as a row of text. */
export function drillText(drill: DepletedDrills, lang: string): string {
  // The mod counts drills that were depleted before its first scan under "unknown".
  const resource = drill.resource === "unknown" ? t(lang, "resource_unknown") : prettyName(drill.resource);
  return tn(lang, "pl_drills", drill.total, { resource, depleted: drill.depleted, total: drill.total });
}
