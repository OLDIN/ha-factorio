/**
 * Pure callouts of the system map: what to say about each body (from HA states) and where the
 * boxes go. No Lit, no DOM.
 */
import { entityId } from "../shared/entities";
import { t } from "../shared/i18n";
import { bodyName } from "../shared/names";
import { drillText, lineText, readDrills, readLines } from "../shared/production";
import { asDict, asList, type HassState } from "../shared/types";
import { labelRect, prettyName, type Body, type Placed, type Rect } from "./layout";

export interface CalloutLine {
  text: string;
  tone: "text" | "muted" | "amber";
}

export interface CalloutInput {
  body: string;
  /** attack: red box with a hazard strip; warning: amber box. */
  tone: "attack" | "warning";
  title: string;
  lines: CalloutLine[];
}

export interface Callout extends CalloutInput {
  x: number;
  y: number;
  width: number;
  height: number;
  band: "top" | "bottom";
  /** Baselines: the title first, then one per line. */
  baselines: number[];
  /** From the edge of the body to the edge of the box. */
  line: { x1: number; y1: number; x2: number; y2: number };
}

export interface BandRange {
  x0: number;
  x1: number;
}

export interface CalloutArea {
  width: number;
  height: number;
  /** Horizontal extent of the upper band (default: the whole width minus 16 px margins). */
  top?: BandRange;
  /** Horizontal extent of the lower band. */
  bottom?: BandRange;
  /** Label boxes as drawn; by default each body's label with its sublabel. */
  labels?: Rect[];
  /** Second label lines under body names (research progress, machines share): a lead starts past them. */
  sublabels?: ReadonlyMap<string, string>;
}

export const CALLOUT_TITLE_FONT = 13;
export const CALLOUT_LINE_FONT = 13;
export const HAZARD_STRIP = 7;
const TITLE_CHAR = 10.2; // Unbounded is wide
const LINE_CHAR = 7;
const PAD_X = 14;
const MIN_WIDTH = 170;
const MAX_WIDTH = 360;
/** A long line wraps into at most this many lines; the rest is cut with "…". */
const MAX_WRAP = 3;
/** Gap between a body's own label and the lead that starts past it. */
const LEAD_GAP = 3;
const EDGE = 14; // distance of the first row from the card edge
const ROW_GAP = 12;
const BOX_GAP = ROW_GAP;
const BODY_CLEARANCE = 4;
const REACH = 300;
const LABEL_TOLERANCE = 2;

/** Game states in which nothing ticks, with the i18n key that says so. */
const FROZEN: Record<string, string | undefined> = {
  paused: "game_paused",
  stopped: "game_stopped",
  no_connection: "game_no_connection",
};

/** The i18n key of the game state when the game does not tick (paused, stopped, offline), else undefined. */
export function frozenKey(states: Record<string, HassState | undefined>, serverId: string): string | undefined {
  return FROZEN[states[entityId(serverId, "sensor", "game_state")]?.state ?? ""];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A non-negative whole count from a state or attribute; anything else (unknown, unavailable) is 0. */
export function count(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** "Stone wall ×12, Gun turret ×4, +3 more": the biggest losses first, plural-free in every language. */
export function formatLosses(losses: unknown, lang: string): string {
  const entries = Object.entries(asDict(losses))
    .map(([name, n]) => [name, count(n)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return "";
  // A no-break space keeps the count with its item when the line wraps.
  const shown = entries.slice(0, 3).map(([name, n]) => `${prettyName(name)}\u00a0×${n}`);
  const rest = entries.slice(3).reduce((sum, [, n]) => sum + n, 0);
  if (rest > 0) shown.push(t(lang, "attack_more", { count: rest }));
  return shown.join(", ");
}

/**
 * One callout per body that needs attention: an attack (red, with losses and the planet's
 * other problems) or turrets without ammo / power and damaged walls (amber).
 * Planet entities exist only for built planets; a missing entity means nothing to show.
 */
export function collectAlerts(
  states: Record<string, HassState | undefined>,
  serverId: string,
  bodies: Body[],
  lang: string,
  now: number,
): CalloutInput[] {
  const out: CalloutInput[] = [];
  const seen = new Set<string>();
  const frozen = frozenKey(states, serverId);
  for (const body of bodies) {
    if (!body || typeof body.name !== "string" || seen.has(body.name)) continue;
    seen.add(body.name);
    const planet = bodyName(body.name, lang);
    const problems: string[] = [];
    const turrets = states[entityId(serverId, "sensor", "turrets_no_ammo", body.name)];
    const noAmmo = count(turrets?.state);
    if (noAmmo > 0) problems.push(t(lang, "turrets_no_ammo", { count: noAmmo }));
    const noPower = count(asDict(turrets?.attributes).no_power);
    if (noPower > 0) problems.push(t(lang, "turrets_no_power", { count: noPower }));
    const damaged = count(states[entityId(serverId, "sensor", "walls_damaged", body.name)]?.state);
    if (damaged > 0) problems.push(t(lang, "walls_damaged", { count: damaged }));

    const problemLines = readLines(states, serverId, body.name) ?? [];
    const production = [...problemLines.map((l) => lineText(l, lang)), ...(readDrills(states, serverId, body.name) ?? []).map((d) => drillText(d, lang))];

    const attack = states[entityId(serverId, "binary_sensor", "under_attack", body.name)];
    if (attack?.state === "on") {
      const attrs = asDict(attack.attributes);
      // since_tick cannot be turned into wall time; the entity's last change is when the attack began.
      const since = typeof attack.last_changed === "string" ? Date.parse(attack.last_changed) : NaN;
      const minutes = Number.isFinite(since) ? Math.floor((now - since) / 60_000) : null;
      // While the game does not tick, the attack cannot end and its minutes mean nothing.
      const title =
        frozen !== undefined
          ? t(lang, "attack_title_frozen", { planet, state: t(lang, frozen) })
          : minutes === null
            ? t(lang, "attack_title_now", { planet })
            : t(lang, "attack_title", { planet, minutes: minutes < 1 ? "<1" : minutes });
      const lines: CalloutLine[] = [];
      const losses = formatLosses(attrs.losses, lang);
      if (losses) lines.push({ text: t(lang, "attack_losses", { list: losses }), tone: "text" });
      const pos = asList(attrs.position);
      if (pos.length >= 2 && isNum(pos[0]) && isNum(pos[1]))
        lines.push({ text: t(lang, "attack_near", { position: `[${Math.round(pos[0])}, ${Math.round(pos[1])}]` }), tone: "muted" });
      for (const text of [...problems, ...production]) lines.push({ text, tone: "amber" });
      out.push({ body: body.name, tone: "attack", title, lines });
    } else if (problems.length > 0 || problemLines.length > 0) {
      // Depleted drills alone make no callout (the planets card has them); with a problem line they ride along.
      out.push({
        body: body.name,
        tone: "warning",
        title:
          problems.length > 0
            ? t(lang, "defense_title", { planet })
            : problemLines.length === 1
              ? t(lang, "line_stopped_title", { planet })
              : t(lang, "lines_stopped_title", { planet, count: problemLines.length }),
        lines: [...problems, ...production].map((text) => ({ text, tone: "text" as const })),
      });
    }
  }
  return out;
}

function truncate(text: string, chars: number): string {
  return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1))}…`;
}

interface Sized {
  item: CalloutInput;
  body: Placed;
  width: number;
  height: number;
  baselines: number[]; // relative to the box top
  label: Rect; // the body's own label as drawn, sublabel included
}

/** Greedy word wrap into lines of at most `chars` characters; at most `max` lines, the last one cut with "…". */
export function wrapText(text: string, chars: number, max: number): string[] {
  const out: string[] = [];
  let line = "";
  // Only ordinary spaces break: no-break spaces hold their words together.
  for (const word of text.split(/[ \t\n]+/).filter((w) => w !== "")) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= chars) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line !== "") out.push(line);
  const lines = out.map((l) => truncate(l, chars));
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), truncate(`${lines[max - 1]} ${lines[max]}`, chars - 1).replace(/…?$/, "…")];
}

function measure(item: CalloutInput, body: Placed, maxWidth: number, label: Rect): Sized {
  const natural = Math.ceil(Math.max(item.title.length * TITLE_CHAR, ...item.lines.map((l) => l.text.length * LINE_CHAR)) + 2 * PAD_X);
  const width = Math.min(maxWidth, MAX_WIDTH, Math.max(MIN_WIDTH, natural));
  const inner = width - 2 * PAD_X;
  const title = truncate(item.title, Math.floor(inner / TITLE_CHAR));
  const perLine = Math.max(1, Math.floor(inner / LINE_CHAR));
  const lines = item.lines.flatMap((l) => wrapText(l.text, perLine, MAX_WRAP).map((text) => ({ ...l, text })));
  const strip = item.tone === "attack" ? HAZARD_STRIP : 0;
  const baselines = [strip + 25];
  lines.forEach((_, k) => baselines.push(strip + 25 + 21 + k * 19));
  const height = baselines[baselines.length - 1] + 13;
  return { item: { ...item, title, lines }, body, width, height, baselines, label };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxesOverlap = (a: Box, b: Box, gap: number): boolean =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/** How far sideways a box may go from its body before another row (or band) is better. */
const reachOf = (s: Sized): number => Math.max(s.width, REACH);

function boxHitsBody(box: Box, p: Placed): boolean {
  const nx = Math.min(Math.max(p.cx, box.x), box.x + box.width);
  const ny = Math.min(Math.max(p.cy, box.y), box.y + box.height);
  return Math.hypot(nx - p.cx, ny - p.cy) < p.r + BODY_CLEARANCE;
}

/** A label under the box; labels have some empty leading, hence the tolerance. */
const boxHitsLabel = (box: Box, r: Rect): boolean =>
  box.x < r.x1 - LABEL_TOLERANCE &&
  r.x0 + LABEL_TOLERANCE < box.x + box.width &&
  box.y < r.y1 - LABEL_TOLERANCE &&
  r.y0 + LABEL_TOLERANCE < box.y + box.height;

type Line = Callout["line"];

/** Bodies other than its own that a lead line passes through. */
function crossings(line: Line, placed: Placed[], own: string): number {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const len2 = dx * dx + dy * dy;
  let n = 0;
  for (const p of placed) {
    if (p.name === own) continue;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.cx - line.x1) * dx + (p.cy - line.y1) * dy) / len2)) : 0;
    if (Math.hypot(line.x1 + t * dx - p.cx, line.y1 + t * dy - p.cy) < p.r + 2) n++;
  }
  return n;
}

/** The lead passes through the label box (Liang–Barsky clipping; labels have some empty leading, hence the tolerance). */
function leadHitsLabel(line: Line, r: Rect): boolean {
  const x0 = r.x0 + LABEL_TOLERANCE;
  const x1 = r.x1 - LABEL_TOLERANCE;
  const y0 = r.y0 + LABEL_TOLERANCE;
  const y1 = r.y1 - LABEL_TOLERANCE;
  if (x0 >= x1 || y0 >= y1) return false;
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  let lo = 0;
  let hi = 1;
  for (const [p, q] of [
    [-dx, line.x1 - x0],
    [dx, x1 - line.x1],
    [-dy, line.y1 - y0],
    [dy, y1 - line.y1],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
      if (lo > hi) return false;
    }
  }
  return true;
}

/** Two lead lines cross (touching ends do not count). */
function leadsCross(a: Line, b: Line): boolean {
  const side = (p: Line, x: number, y: number): number => Math.sign((p.x2 - p.x1) * (y - p.y1) - (p.y2 - p.y1) * (x - p.x1));
  return side(a, b.x1, b.y1) * side(a, b.x2, b.y2) < 0 && side(b, a.x1, a.y1) * side(b, a.x2, a.y2) < 0;
}

/**
 * From the edge of the body to the facing edge of the box. When the body's own label sits
 * between the body and the box (under it for a box below, above it for a box above), the lead
 * starts just past the label instead of running through it.
 */
function leadLine(s: Sized, x: number, y: number): Line {
  const x2 = Math.min(Math.max(s.body.cx, x + 12), x + s.width - 12);
  const above = y + s.height <= s.body.cy;
  const below = y >= s.body.cy;
  if (!above && !below) {
    // The box is level with the body (crowded maps only): the shortest lead, to its nearer edge.
    const up = s.body.cy - y < y + s.height - s.body.cy;
    return { x1: s.body.cx, y1: up ? s.body.cy - s.body.r : s.body.cy + s.body.r, x2, y2: up ? y : y + s.height };
  }
  // Later rows of a crowded band can end up on the other side of the body: lead to where the box is.
  const top = above;
  const own = s.label;
  const across = own.x0 < s.body.cx && s.body.cx < own.x1;
  const y1 = top
    ? across && own.y1 <= s.body.cy
      ? own.y0 - LEAD_GAP
      : s.body.cy - s.body.r
    : across && own.y0 >= s.body.cy
      ? own.y1 + LEAD_GAP
      : s.body.cy + s.body.r;
  return {
    x1: s.body.cx,
    y1,
    x2,
    y2: top ? y + s.height : y,
  };
}

/** A lead through another body counts like this many extra pixels when choosing a band. */
const CROSSING_COST = 400;

/**
 * Boxes in two bands: bodies of the upper half get the upper band, the rest the lower one.
 * (Precisely: the band with the shorter lead line, counting the sideways shift that the band's
 * extent forces and the bodies the lead would cross; without those that is always the band of
 * the body's half.)
 * In a band boxes go left to right by their body's x, as close to it as they can without
 * overlapping each other, covering a body or a label, or leading across a body; what does not
 * fit starts another row.
 */
export function placeCallouts(items: CalloutInput[], placed: Placed[], size: CalloutArea): Callout[] {
  const byName = new Map(placed.map((p) => [p.name, p]));
  const ownLabel = (p: Placed): Rect => labelRect(p, size.sublabels?.get(p.name));
  const labels = size.labels ?? placed.map(ownLabel);
  const result: Callout[] = [];
  const overflow: Sized[] = [];
  /** Boxes that had to cover a body or label or lead across one, with what they were made from. */
  const compromised = new Map<Callout, CalloutInput>();
  const make = (s: Sized, x: number, y: number, band: "top" | "bottom"): Callout => ({
    ...s.item,
    x,
    y,
    width: s.width,
    height: s.height,
    band,
    baselines: s.baselines.map((b) => y + b),
    line: leadLine(s, x, y),
  });
  const rangeOf = (band: "top" | "bottom"): BandRange => size[band] ?? { x0: 16, x1: size.width - 16 };
  const spanOf = (band: "top" | "bottom"): number => Math.max(0, rangeOf(band).x1 - rangeOf(band).x0);
  /** Rough cost of the lead line from the body to the first row of `band`. */
  const lead = (s: Sized, band: "top" | "bottom"): number => {
    const { x0, x1 } = rangeOf(band);
    const preferred = s.body.cx - s.width / 2;
    const x = Math.min(Math.max(preferred, x0), Math.max(x0, x1 - s.width));
    const y = band === "top" ? EDGE : size.height - EDGE - s.height;
    const gap = band === "top" ? s.body.cy - s.body.r - (y + s.height) : y - (s.body.cy + s.body.r);
    const line = leadLine(s, x, y);
    return Math.hypot(Math.max(0, gap), Math.abs(x - preferred)) + CROSSING_COST * crossings(line, placed, s.item.body);
  };
  const assigned = items
    .filter((item) => byName.has(item.body))
    .map((item) => {
      const body = byName.get(item.body)!;
      const own = body.cy < size.height / 2 ? "top" : "bottom";
      const other = own === "top" ? "bottom" : "top";
      const s = measure(item, body, spanOf(own), ownLabel(body));
      const alt = measure(item, body, spanOf(other), ownLabel(body));
      // The band of the body's half, unless its extent (summary, legend) makes the other band's lead shorter.
      return { input: item, ...(lead(alt, other) < lead(s, own) ? { band: other, s: alt } : { band: own, s }) };
    });
  const inputOf = new Map(assigned.map((a) => [a.s, a.input]));
  // Tier 2: covers no body or label, its lead crosses no body, label or lead; 1: covers nothing; 0: anything.
  const fitsAt = (s: Sized, x: number, y: number, others: Callout[], tier: number): boolean => {
    const box = { x, y, width: s.width, height: s.height };
    if (others.some((c) => boxesOverlap(box, c, BOX_GAP))) return false;
    if (tier >= 1 && (placed.some((p) => boxHitsBody(box, p)) || labels.some((l) => boxHitsLabel(box, l)))) return false;
    if (tier < 2) return true;
    const line = leadLine(s, x, y);
    return (
      crossings(line, placed, s.item.body) === 0 &&
      !labels.some((l) => leadHitsLabel(line, l)) &&
      !others.some((c) => leadsCross(line, c.line))
    );
  };
  for (const band of ["top", "bottom"] as const) {
    const range = rangeOf(band);
    const span = spanOf(band);
    let pending: Sized[] = assigned
      .filter((a) => a.band === band)
      .map((a) => a.s)
      .sort((a, b) => a.body.cx - b.body.cx || a.item.body.localeCompare(b.item.body));
    let edge = band === "top" ? EDGE : size.height - EDGE;
    while (pending.length > 0) {
      const row: Callout[] = [];
      const deferred: Sized[] = [];
      for (const s of pending) {
        const y = band === "top" ? edge : edge - s.height;
        const lo = range.x0;
        const hi = Math.max(range.x0, range.x1 - s.width);
        const preferred = Math.min(Math.max(s.body.cx - s.width / 2, lo), hi);
        const fits = (x: number, tier: number): boolean => fitsAt(s, x, y, [...result, ...row], tier);
        // A box strays only so far from its body; farther than that, the next row is better.
        const reach = row.length === 0 ? span : Math.min(span, reachOf(s));
        let x: number | null = null;
        let got = 2;
        for (const tier of [2, 1, 0]) {
          for (let step = 0; step <= reach && x === null; step += 20)
            // Boxes already in the row belong to bodies on the left: going right keeps the leads from crossing.
            for (const cand of step === 0 ? [preferred] : row.length > 0 ? [preferred + step, preferred - step] : [preferred - step, preferred + step])
              if (cand >= lo - 1e-6 && cand <= hi + 1e-6 && fits(cand, tier)) {
                x = cand;
                break;
              }
          if (x !== null) {
            got = tier;
            break;
          }
        }
        if (x !== null) {
          const c = make(s, x, y, band);
          row.push(c);
          if (got < 2) compromised.set(c, inputOf.get(s)!);
        }
        else if (row.length > 0) deferred.push(s);
        else overflow.push(s); // even an empty row has no room: the bands have run into each other
      }
      if (row.length === 0) break;
      result.push(...row);
      edge =
        band === "top"
          ? Math.max(...row.map((c) => c.y + c.height)) + ROW_GAP
          : Math.min(...row.map((c) => c.y)) - ROW_GAP;
      pending = deferred;
    }
  }
  // Far too many alerts for the bands: any free spot on the card, the nearest to the body.
  for (const s of overflow) {
    let best: { x: number; y: number; score: number } | null = null;
    for (let y = 4; y <= size.height - s.height - 4; y += 6)
      for (let x = 4; x <= size.width - s.width - 4; x += 10) {
        const box = { x, y, width: s.width, height: s.height };
        const score =
          result.filter((c) => boxesOverlap(box, c, BOX_GAP)).length * 10_000 +
          placed.filter((p) => boxHitsBody(box, p)).length * 100 +
          Math.hypot(x + s.width / 2 - s.body.cx, y + s.height / 2 - s.body.cy) / 100;
        if (!best || score < best.score) best = { x, y, score };
      }
    const { x, y } = best ?? { x: 4, y: 4 };
    const c = make(s, x, y, y + s.height / 2 < s.body.cy ? "top" : "bottom");
    result.push(c);
    compromised.set(c, inputOf.get(s)!);
  }
  // Second chance, once every box has a place: a compromised box moves to the clean spot (tier 2,
  // covering no other lead either) with the shortest lead in any row of either band, if there is one.
  // Moving one can free the room another needed, hence two passes.
  for (let pass = 0; pass < 2 && compromised.size > 0; pass++)
    for (const [c, input] of [...compromised]) {
      const others = result.filter((o) => o !== c);
      const better = cleanSpot(input, byName.get(c.body)!, others);
      if (better === null) continue;
      result[result.indexOf(c)] = better;
      compromised.delete(c);
    }
  return result;

  function cleanSpot(input: CalloutInput, body: Placed, others: Callout[]): Callout | null {
    let best: { c: Callout; cost: number } | null = null;
    for (const band of ["top", "bottom"] as const) {
      const s = measure(input, body, spanOf(band), ownLabel(body));
      const inBand = others.filter((o) => o.band === band);
      const ys =
        band === "top"
          ? [...new Set(inBand.map((o) => o.y)), inBand.length > 0 ? Math.max(...inBand.map((o) => o.y + o.height)) + ROW_GAP : EDGE]
          : [...new Set(inBand.map((o) => o.y + o.height)), inBand.length > 0 ? Math.min(...inBand.map((o) => o.y)) - ROW_GAP : size.height - EDGE].map(
              (bottom) => bottom - s.height,
            );
      const { x0, x1 } = rangeOf(band);
      const hi = Math.max(x0, x1 - s.width);
      const preferred = Math.min(Math.max(s.body.cx - s.width / 2, x0), hi);
      for (const y of ys) {
        if (y < 4 || y + s.height > size.height - 4) continue;
        for (let step = 0; step <= hi - x0; step += 20) {
          const x = [preferred - step, preferred + step].find((cand) => cand >= x0 - 1e-6 && cand <= hi + 1e-6 && cleanAt(s, cand, y, others));
          if (x === undefined) continue;
          const c = make(s, x, y, band);
          const cost = Math.hypot(c.line.x2 - c.line.x1, c.line.y2 - c.line.y1);
          if (!best || cost < best.cost) best = { c, cost };
          break;
        }
      }
    }
    return best?.c ?? null;
  }

  function cleanAt(s: Sized, x: number, y: number, others: Callout[]): boolean {
    const box: Rect = { x0: x, y0: y, x1: x + s.width, y1: y + s.height };
    return fitsAt(s, x, y, others, 2) && !others.some((o) => leadHitsLabel(o.line, box));
  }
}
