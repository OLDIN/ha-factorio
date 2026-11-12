/** What the planets card shows, from HA states. Pure: no Lit, no DOM. */
import { count, formatLosses, frozenKey } from "../map/callouts";
import type { Body } from "../map/layout";
import { entityId } from "../shared/entities";
import { t, tn } from "../shared/i18n";
import { prettyName } from "../shared/names";
import { readDrills, readLines, readMachines, type Machines } from "../shared/production";
import { asDict, asList, type HassState } from "../shared/types";

export interface PlanetLine {
  text: string;
  tone: "red" | "amber";
}

export interface PlanetRow {
  name: string;
  /** red: under attack; amber: defense problems; green: nothing to say. */
  tone: "red" | "amber" | "green";
  /** Defense, problem-line and depleted-drill lines. */
  lines: PlanetLine[];
  /** Machines working on the planet, null without data. */
  machines: Machines | null;
  /** Enemy evolution in %, null when unknown. */
  evolution: number | null;
}

export interface PlanetsModel {
  attention: PlanetRow[];
  healthy: PlanetRow[];
  /** Unlocked planets with nothing built. */
  unlocked: string[];
  /** Planets not unlocked yet; progress (%) of the one being researched. */
  locked: { name: string; progress: number | null }[];
  /** Planets in all lists. */
  total: number;
}

type States = Record<string, HassState | undefined>;

const IDLE = new Set(["unknown", "unavailable", ""]);

function bodiesOf(states: States, sid: string): Body[] {
  return asList(states[entityId(sid, "sensor", "bodies")]?.attributes?.bodies).filter(
    (b): b is Body => b !== null && typeof b === "object" && typeof (b as Body).name === "string" && (b as Body).name !== "",
  );
}

function evolutionOf(states: States, sid: string, name: string): number | null {
  const raw = states[entityId(sid, "sensor", "evolution", name)]?.state;
  const n = raw === undefined || IDLE.has(raw) ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Bodies the current research unlocks, with its progress (0–100). */
function researched(states: States, sid: string): Map<string, number> {
  const out = new Map<string, number>();
  const state = states[entityId(sid, "sensor", "research")];
  if (!state || IDLE.has(state.state)) return out;
  const attrs = asDict(state.attributes);
  const p = Number(attrs.progress);
  const progress = Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
  for (const name of asList(attrs.unlocks)) if (typeof name === "string") out.set(name, progress);
  return out;
}

function rowOf(states: States, sid: string, name: string, lang: string, now: number, frozen: string | undefined): PlanetRow {
  const lines: PlanetLine[] = [];
  const attack = states[entityId(sid, "binary_sensor", "under_attack", name)];
  if (attack?.state === "on") {
    const since = typeof attack.last_changed === "string" ? Date.parse(attack.last_changed) : NaN;
    const minutes = Number.isFinite(since) ? Math.floor((now - since) / 60_000) : null;
    const what =
      frozen !== undefined
        ? t(lang, "pl_attack_frozen", { state: t(lang, frozen) })
        : minutes === null
          ? t(lang, "pl_attack_now")
          : t(lang, "pl_attack", { minutes: minutes < 1 ? "<1" : minutes });
    const losses = formatLosses(asDict(attack.attributes).losses, lang);
    lines.push({ text: losses ? t(lang, "pl_lost", { what, list: losses }) : what, tone: "red" });
  }
  const turrets = states[entityId(sid, "sensor", "turrets_no_ammo", name)];
  const noAmmo = count(turrets?.state);
  if (noAmmo > 0) lines.push({ text: t(lang, "turrets_no_ammo", { count: noAmmo }), tone: "amber" });
  const noPower = count(asDict(turrets?.attributes).no_power);
  if (noPower > 0) lines.push({ text: t(lang, "turrets_no_power", { count: noPower }), tone: "amber" });
  const walls = count(states[entityId(sid, "sensor", "walls_damaged", name)]?.state);
  if (walls > 0) lines.push({ text: t(lang, "walls_damaged", { count: walls }), tone: "amber" });
  for (const l of readLines(states, sid, name) ?? []) {
    const reason = l.reason === "" ? "" : `, ${t(lang, `reason_${l.reason}`)}`;
    const minutes = l.minutes < 1 ? "<1" : l.minutes;
    lines.push({ text: t(lang, "pl_line", { recipe: prettyName(l.recipe), stopped: l.stopped, total: l.total, reason, minutes }), tone: "amber" });
  }
  for (const d of readDrills(states, sid, name) ?? []) {
    lines.push({ text: tn(lang, "pl_drills", d.total, { resource: prettyName(d.resource), depleted: d.depleted, total: d.total }), tone: "amber" });
  }
  const tone = lines.some((l) => l.tone === "red") ? "red" : lines.length > 0 ? "amber" : "green";
  return { name, tone, lines, machines: readMachines(states, sid, name), evolution: evolutionOf(states, sid, name) };
}

/**
 * Built planets that need attention (attacks first, then by how much is wrong), the healthy
 * ones, and the unlocked / not yet unlocked ones. Space locations are not planets: they are
 * only on the map. Bodies keep their order from the game otherwise.
 */
export function planetsModel(states: States, sid: string, lang: string, now: number): PlanetsModel {
  const frozen = frozenKey(states, sid);
  const research = researched(states, sid);
  const seen = new Set<string>();
  const planets = bodiesOf(states, sid).filter((b) => {
    if (b.kind === "space-location" || seen.has(b.name)) return false;
    seen.add(b.name);
    return true;
  });
  const rows = planets.filter((b) => b.state === "built").map((b) => rowOf(states, sid, b.name, lang, now, frozen));
  const rank = (r: PlanetRow): number => (r.tone === "red" ? 0 : 1);
  const attention = rows
    .filter((r) => r.tone !== "green")
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || b.r.lines.length - a.r.lines.length || a.i - b.i)
    .map(({ r }) => r);
  const locked = planets
    .filter((b) => b.state !== "built" && b.state !== "unlocked")
    .map((b, i) => ({ name: b.name, progress: research.get(b.name) ?? null, i }))
    .sort((a, b) => (a.progress === null ? 1 : 0) - (b.progress === null ? 1 : 0) || a.i - b.i)
    .map(({ name, progress }) => ({ name, progress }));
  return {
    attention,
    healthy: rows.filter((r) => r.tone === "green"),
    unlocked: planets.filter((b) => b.state === "unlocked").map((b) => b.name),
    locked,
    total: planets.length,
  };
}
