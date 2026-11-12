/** What the header card shows, from HA states. Pure: no Lit, no DOM. */
import { entityId, slug } from "../shared/entities";
import { asDict, asList, type HassState } from "../shared/types";

export type GameState = "running" | "paused" | "stopped" | "no_connection";

export interface HeaderModel {
  game: GameState | null;
  /** Bodies under attack (game ids), sorted. */
  attacked: string[];
  players: number | null;
  /** queued: entries after the current one. */
  research: { name: string; level: number; progress: number; queued: number } | null;
}

const GAME = new Set(["running", "paused", "stopped", "no_connection"]);
const IDLE = new Set(["unknown", "unavailable", "", "None"]);

export function headerModel(states: Record<string, HassState | undefined>, sid: string): HeaderModel {
  const game = states[entityId(sid, "sensor", "game_state")]?.state;

  // Planet entities exist per built planet: the attacked ones are those whose sensor is on.
  const bodies = asList(states[entityId(sid, "sensor", "bodies")]?.attributes?.bodies)
    .map((b) => asDict(b).name)
    .filter((n): n is string => typeof n === "string");
  const re = new RegExp(`^binary_sensor\\.factorio_${slug(sid)}_(.+)_under_attack$`);
  const attacked: string[] = [];
  for (const [id, state] of Object.entries(states)) {
    const part = re.exec(id)?.[1];
    if (part !== undefined && state?.state === "on") attacked.push(bodies.find((b) => slug(b) === part) ?? part);
  }

  const n = Number(states[entityId(sid, "sensor", "players_online")]?.state ?? NaN);

  const rs = states[entityId(sid, "sensor", "research")];
  let research: HeaderModel["research"] = null;
  if (rs && !IDLE.has(rs.state)) {
    const attrs = asDict(rs.attributes);
    const level = Number(attrs.level);
    const progress = Number(attrs.progress);
    research = {
      name: rs.state,
      level: Number.isFinite(level) && level > 0 ? level : 1,
      progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0,
      queued: Math.max(0, asList(attrs.queue).length - 1),
    };
  }
  return {
    game: game !== undefined && GAME.has(game) ? (game as GameState) : null,
    attacked: attacked.sort(),
    players: Number.isFinite(n) ? n : null,
    research,
  };
}
