/**
 * Pure content of the system map's popups: for every body that has something to say, a title
 * with a chip, a table of facts and a footer of the checks that passed. No Lit, no DOM.
 */
import { entityId } from "../shared/entities";
import { t } from "../shared/i18n";
import { bodyName } from "../shared/names";
import { machinesShare, readDrills, readLines, type DepletedDrills, type Machines, type ProblemLine } from "../shared/production";
import { asDict, asList, type HassState } from "../shared/types";
import { prettyName, type Body } from "./layout";

/** One row of the popup's table. */
export interface PopupFact {
  label: string;
  /** One value, or several shown one under another. */
  value: string | string[];
  /** Small text under the row (why a line stands). */
  note?: string;
  /** This row is the problem: its value takes the colour of the popup. */
  bad?: boolean;
  /** A share under the row: solid is a thin bar (machines), segments are twenty cells like the game's evolution bar. */
  bar?: { percent: number; style: "solid" | "segments" };
}

export interface Popup {
  body: string;
  /** attack: red, a hazard strip; warning: amber; ok: nothing is wrong, the popup says how it is. */
  tone: "attack" | "warning" | "ok";
  title: string;
  swatch: "planet" | "platform";
  /** What is going on, after the title ("Attack · 4 min", "All well"); null for nothing to say. */
  chip: string | null;
  facts: PopupFact[];
  /** The checks that passed, in the footer. */
  checks: string[];
}

/** Game states in which nothing ticks. The header chip already names the state, so a popup only drops the minutes. */
const FROZEN = new Set(["paused", "stopped", "no_connection"]);

/** True when the game does not tick (paused, stopped, offline). */
export function isFrozen(states: Record<string, HassState | undefined>, serverId: string): boolean {
  return FROZEN.has(states[entityId(serverId, "sensor", "game_state")]?.state ?? "");
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A non-negative whole count from a state or attribute; anything else (unknown, unavailable) is 0. */
export function count(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Losses as items, the biggest first: "Stone wall ×12", "Gun turret ×4", then "+3 more". Plural-free in every language. */
export function lossItems(losses: unknown, lang: string): string[] {
  const entries = Object.entries(asDict(losses))
    .map(([name, n]) => [name, count(n)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // A no-break space keeps the count with its item when the line wraps.
  const shown = entries.slice(0, 3).map(([name, n]) => `${prettyName(name)}\u00a0×${n}`);
  const rest = entries.slice(3).reduce((sum, [, n]) => sum + n, 0);
  if (rest > 0) shown.push(t(lang, "attack_more", { count: rest }));
  return shown;
}

/** The losses on one line: "Stone wall ×12, Gun turret ×4, +3 more". */
export function formatLosses(losses: unknown, lang: string): string {
  return lossItems(losses, lang).join(", ");
}

/** "Scrap recycling   31 of 48" with "no input · 11 min" under it: one stopped line. */
export function lineFact(line: ProblemLine, lang: string): PopupFact {
  const minutes = t(lang, "tl_min", { n: line.minutes < 1 ? "<1" : line.minutes });
  const note = [line.reason === "" ? null : t(lang, `reason_${line.reason}`), minutes].filter((x) => x !== null).join(" · ");
  return { label: prettyName(line.recipe), value: t(lang, "st_of", { n: line.stopped, total: line.total }), note, bad: true };
}

/** "Iron ore, depleted drills   14 of 96". */
export function drillFact(drill: DepletedDrills, lang: string): PopupFact {
  const resource = drill.resource === "unknown" ? t(lang, "resource_unknown") : prettyName(drill.resource);
  return { label: t(lang, "st_drills_depleted", { resource }), value: t(lang, "st_of", { n: drill.depleted, total: drill.total }), bad: true };
}

/** The first row of a planet's popup: how many machines are without problems, with a bar. */
function machinesFact(m: Machines | undefined, lang: string): PopupFact[] {
  if (!m) return [];
  return [{ label: t(lang, "st_machines"), value: t(lang, "st_of", { n: m.ok ?? m.working, total: m.total }), bar: { percent: machinesShare(m), style: "solid" } }];
}

type States = Record<string, HassState | undefined>;

/** The checks of a planet that passed, for the footer: only those whose sensor reports. */
function passedChecks(states: States, serverId: string, name: string, lang: string): string[] {
  const out: string[] = [];
  const turrets = states[entityId(serverId, "sensor", "turrets_no_ammo", name)];
  if (count(asDict(turrets?.attributes).total) > 0 && count(turrets?.state) === 0) out.push(t(lang, "ck_ammo"));
  const walls = states[entityId(serverId, "sensor", "walls_damaged", name)];
  if (walls !== undefined && Number.isFinite(Number(walls.state)) && count(walls.state) === 0) out.push(t(lang, "ck_walls"));
  if (readDrills(states, serverId, name)?.length === 0) out.push(t(lang, "ck_drills"));
  if (readLines(states, serverId, name)?.length === 0) out.push(t(lang, "ck_lines"));
  return out;
}

/** The popup as one sentence, for the map's accessible summary. */
export function popupText(p: Popup): string {
  const facts = p.facts.map((f) => {
    const value = Array.isArray(f.value) ? f.value.join(", ") : f.value;
    return value === "" ? f.label : `${f.label}: ${value}`;
  });
  return [p.chip === null ? p.title : `${p.title}: ${p.chip}`, ...facts].join(", ");
}

/**
 * One popup per body that needs attention: an attack (red: losses, where, and the planet's
 * other problems), turrets without ammo / power and damaged walls, or stopped lines (amber).
 * Planet entities exist only for built planets; a missing entity means nothing to show.
 */
export function collectAlerts(states: States, serverId: string, bodies: Body[], lang: string, now: number, machines: ReadonlyMap<string, Machines> = new Map()): Popup[] {
  const out: Popup[] = [];
  const seen = new Set<string>();
  const frozen = isFrozen(states, serverId);
  for (const body of bodies) {
    if (!body || typeof body.name !== "string" || seen.has(body.name)) continue;
    seen.add(body.name);
    const defense: PopupFact[] = [];
    const turrets = states[entityId(serverId, "sensor", "turrets_no_ammo", body.name)];
    const noAmmo = count(turrets?.state);
    if (noAmmo > 0) defense.push({ label: t(lang, "st_no_ammo"), value: String(noAmmo), bad: true });
    const noPower = count(asDict(turrets?.attributes).no_power);
    if (noPower > 0) defense.push({ label: t(lang, "st_no_power"), value: String(noPower), bad: true });
    const damaged = count(states[entityId(serverId, "sensor", "walls_damaged", body.name)]?.state);
    if (damaged > 0) defense.push({ label: t(lang, "st_walls_damaged"), value: String(damaged), bad: true });

    const problemLines = readLines(states, serverId, body.name) ?? [];
    const production = [...problemLines.map((l) => lineFact(l, lang)), ...(readDrills(states, serverId, body.name) ?? []).map((d) => drillFact(d, lang))];
    const popup = { body: body.name, title: bodyName(body.name, lang), swatch: "planet" as const, checks: passedChecks(states, serverId, body.name, lang) };
    const rows = [...machinesFact(machines.get(body.name), lang)];

    const attack = states[entityId(serverId, "binary_sensor", "under_attack", body.name)];
    if (attack?.state === "on") {
      const attrs = asDict(attack.attributes);
      // since_tick cannot be turned into wall time; the entity's last change is when the attack began.
      const since = typeof attack.last_changed === "string" ? Date.parse(attack.last_changed) : NaN;
      const minutes = Number.isFinite(since) ? Math.floor((now - since) / 60_000) : null;
      // While the game does not tick, the attack cannot end and its minutes mean nothing.
      const chip = frozen || minutes === null ? t(lang, "chip_attack") : t(lang, "chip_attack_min", { minutes: minutes < 1 ? "<1" : minutes });
      const lost = lossItems(attrs.losses, lang);
      if (lost.length > 0) rows.push({ label: t(lang, "st_lost"), value: lost });
      const pos = asList(attrs.position);
      if (pos.length >= 2 && isNum(pos[0]) && isNum(pos[1])) rows.push({ label: t(lang, "st_near"), value: `[${Math.round(pos[0])}, ${Math.round(pos[1])}]` });
      out.push({ ...popup, tone: "attack", chip, facts: [...rows, ...defense, ...production] });
    } else if (defense.length > 0 || problemLines.length > 0) {
      // Depleted drills alone make no alert (the status popup lists them); with a problem line they ride along.
      const chip =
        defense.length > 0
          ? t(lang, "chip_defense")
          : problemLines.length === 1
            ? t(lang, "chip_line")
            : t(lang, "chip_lines", { count: problemLines.length });
      out.push({ ...popup, tone: "warning", chip, facts: [...rows, ...defense, ...production] });
    }
  }
  return out;
}

export interface StatusContext {
  /** Bodies that already have an alert popup. */
  alerting: ReadonlySet<string>;
  /** Research progress by body (the bodies being researched). */
  research: ReadonlyMap<string, number>;
  /** Machine counts of the built planets that report them. */
  machines: ReadonlyMap<string, Machines>;
  /** Platforms standing at each body. */
  platformsAt: ReadonlyMap<string, number>;
}

/**
 * One popup per body that has something to say and nothing wrong: a built planet (machines,
 * enemy evolution, defense, drills), an unlocked or researched one, a body with platforms.
 * A locked body nobody researches has nothing to say.
 */
export function collectStatus(states: States, serverId: string, bodies: Body[], lang: string, ctx: StatusContext): Popup[] {
  const out: Popup[] = [];
  const seen = new Set<string>();
  for (const body of bodies) {
    if (!body || typeof body.name !== "string" || seen.has(body.name) || ctx.alerting.has(body.name)) continue;
    seen.add(body.name);
    const facts: PopupFact[] = [];
    let checks: string[] = [];
    let fine = false;
    if (body.state === "built") {
      const depleted = readDrills(states, serverId, body.name) ?? [];
      fine = depleted.length === 0; // depleted drills alone are no alert, but the planet is not "all well"
      facts.push(...machinesFact(ctx.machines.get(body.name), lang));
      const percent = Number(states[entityId(serverId, "sensor", "evolution", body.name)]?.state);
      if (Number.isFinite(percent)) facts.push({ label: t(lang, "st_evolution"), value: `${Math.round(percent)}%`, bar: { percent, style: "segments" } });
      const total = count(asDict(states[entityId(serverId, "sensor", "turrets_no_ammo", body.name)]?.attributes).total);
      if (total > 0) facts.push({ label: t(lang, "st_turrets"), value: String(total) });
      facts.push(...depleted.map((d) => drillFact(d, lang)));
      checks = passedChecks(states, serverId, body.name, lang);
    } else if (body.state === "unlocked" && body.kind !== "space-location") {
      facts.push({ label: t(lang, "st_state"), value: t(lang, "st_unbuilt") });
    } else if (ctx.research.has(body.name)) {
      const progress = Math.round(ctx.research.get(body.name)!);
      facts.push({ label: t(lang, "st_research"), value: `${progress}%`, bar: { percent: progress, style: "segments" } });
    }
    const nearby = ctx.platformsAt.get(body.name) ?? 0;
    if (nearby > 0) facts.push({ label: t(lang, "st_platforms_here"), value: String(nearby) });
    if (facts.length === 0 && checks.length === 0) continue;
    out.push({ body: body.name, tone: "ok", title: bodyName(body.name, lang), swatch: "planet", chip: fine ? t(lang, "st_all_well") : null, facts, checks });
  }
  return out;
}
