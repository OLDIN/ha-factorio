/** Reader of the platforms sensor for the cards (platforms card, system map). Pure. */
import { entityId } from "./entities";
import type { ProblemLine } from "./production";
import { asDict, asList, type HassState } from "./types";

type States = Record<string, HassState | undefined>;

export type PlatformKind = "flying" | "waiting" | "parked" | "building" | "unknown";

export interface PlatformRoute {
  from: string;
  to: string;
  /** 0–1 from `from` to `to`, in the direction of travel. */
  progress: number;
}

export interface PlatformRow {
  index: number;
  name: string;
  kind: PlatformKind;
  /** Where it stands (parked, waiting, being built); null while flying. */
  location: string | null;
  route: PlatformRoute | null;
  /** Losses of the running damage episode, or of one that ended less than 10 game minutes ago. */
  damage: { active: boolean; losses: Record<string, unknown> } | null;
  /** The worst problem lines (at most two, as the sensor keeps them) and how many more there are. */
  lines: ProblemLine[];
  linesMore: number;
}

/** Platforms shown before "N more". */
export const PLATFORM_ROWS = 8;

const KINDS: Record<string, PlatformKind> = {
  on_the_path: "flying",
  waiting_for_departure: "waiting",
  waiting_at_station: "waiting",
  no_schedule: "parked",
  paused: "parked",
  no_path: "parked",
  waiting_for_starter_pack: "building",
  starter_pack_requested: "building",
  starter_pack_on_the_way: "building",
};

const IDLE = new Set(["unknown", "unavailable", ""]);

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function route(value: unknown): PlatformRoute | null {
  const r = asDict(value);
  const from = text(r.from);
  const to = text(r.to);
  if (from === null || to === null) return null;
  const p = typeof r.progress === "number" && Number.isFinite(r.progress) ? r.progress : 0;
  return { from, to, progress: Math.min(1, Math.max(0, p)) };
}

function line(value: unknown): ProblemLine | null {
  const l = asDict(value);
  const recipe = text(l.recipe);
  const total = count(l.total);
  if (recipe === null || total === 0) return null;
  return { recipe, reason: text(l.reason) ?? "", stopped: Math.min(count(l.stopped), total), total, minutes: count(l.minutes) };
}

/** Game state → what the card says; unknown states (and names like "constructor") are "unknown". */
function kindOf(state: string | null): PlatformKind {
  return state !== null && Object.hasOwn(KINDS, state) ? KINDS[state] : "unknown";
}

/** Damaged first, then with problem lines, then flying, then the rest; by name within each. */
function rank(r: PlatformRow): number {
  if (r.damage) return 0;
  if (r.lines.length > 0) return 1;
  return r.kind === "flying" ? 2 : 3;
}

/** The platforms of a server; null without the sensor or its data. */
export function readPlatforms(states: States, sid: string): PlatformRow[] | null {
  const state = states[entityId(sid, "sensor", "platforms")];
  if (!state || IDLE.has(state.state)) return null;
  const rows: PlatformRow[] = [];
  for (const raw of asList(asDict(state.attributes).platforms)) {
    const p = asDict(raw);
    if (typeof p.index !== "number" || !Number.isFinite(p.index)) continue;
    const damage = p.damage && typeof p.damage === "object" && !Array.isArray(p.damage) ? asDict(p.damage) : null;
    rows.push({
      index: p.index,
      name: text(p.name) ?? `#${p.index}`,
      kind: kindOf(text(p.state)),
      location: text(p.location),
      route: route(p.route),
      damage: damage ? { active: damage.active === true, losses: asDict(damage.losses) } : null,
      lines: asList(p.lines).map(line).filter((l): l is ProblemLine => l !== null),
      linesMore: count(p.lines_more),
    });
  }
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.index - b.index);
}

/** Colour of a platform: amber when damaged or with problem lines, cyan in flight, muted otherwise. */
export function platformTone(r: PlatformRow): "amber" | "cyan" | "muted" {
  if (r.damage || r.lines.length > 0) return "amber";
  return r.kind === "flying" ? "cyan" : "muted";
}
