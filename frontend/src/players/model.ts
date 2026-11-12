/** What the players card shows, from HA states. Pure: no Lit, no DOM. */
import { entityId } from "../shared/entities";
import { parseTime } from "../shared/time";
import { asDict, asList, type HassState } from "../shared/types";

export interface PlayersModel {
  /** Online players: in game first, then AFK ones (afk = minutes, 0 = in game). */
  online: { name: string; afk: number }[];
  /** Deaths of the last hour, newest first. */
  deaths: { player: string; planet: string | null }[];
  /** Who left last (within the hour), when nobody is online. */
  lastLeft: { player: string; minutes: number } | null;
}

const HOUR = 60 * 60_000;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function playersModel(states: Record<string, HassState | undefined>, sid: string, now: number): PlayersModel {
  const attrs = asDict(states[entityId(sid, "sensor", "players_online")]?.attributes);
  const afk = asDict(attrs.afk_minutes);
  const online = [...new Set(asList(attrs.players).filter((p): p is string => typeof p === "string" && p !== ""))]
    .map((name) => {
      const m = Number(afk[name]);
      return { name, afk: Number.isFinite(m) && m > 0 ? Math.round(m) : 0 };
    })
    .sort((a, b) => Number(a.afk > 0) - Number(b.afk > 0) || a.name.localeCompare(b.name));

  const events = asList(states[entityId(sid, "sensor", "recent_events")]?.attributes?.events)
    .map((item) => {
      const e = asDict(item);
      return { event: str(e.event), at: parseTime(e.time), data: asDict(e.data) };
    })
    .filter((e) => Number.isFinite(e.at) && now - e.at <= HOUR)
    .sort((a, b) => b.at - a.at);

  const deaths = events
    .filter((e) => e.event === "player_died" && str(e.data.player) !== "")
    .map((e) => ({ player: str(e.data.player), planet: str(e.data.planet) || null }));
  const left = online.length === 0 ? events.find((e) => e.event === "player_left" && str(e.data.player) !== "") : undefined;
  return {
    online,
    deaths,
    lastLeft: left ? { player: str(left.data.player), minutes: Math.max(0, Math.round((now - left.at) / 60_000)) } : null,
  };
}
