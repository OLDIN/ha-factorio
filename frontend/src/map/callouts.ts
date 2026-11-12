/**
 * Pure callouts of the system map: what to say about each body (from HA states) and where the
 * boxes go. No Lit, no DOM.
 */
import { entityId } from "../shared/entities";
import { t } from "../shared/i18n";
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
  /** Label boxes as drawn; by default each body's one-line label. */
  labels?: Rect[];
}

export const CALLOUT_TITLE_FONT = 13;
export const CALLOUT_LINE_FONT = 13;
export const HAZARD_STRIP = 7;
const TITLE_CHAR = 10.2; // Unbounded is wide
const LINE_CHAR = 7;
const PAD_X = 14;
const MIN_WIDTH = 170;
const MAX_WIDTH = 420;
const EDGE = 14; // distance of the first row from the card edge
const ROW_GAP = 12;
const BOX_GAP = ROW_GAP;
const BODY_CLEARANCE = 4;
const REACH = 300;
const LABEL_TOLERANCE = 2;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A non-negative whole count from a state or attribute; anything else (unknown, unavailable) is 0. */
function count(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** "Stone wall ×12, Gun turret ×4, +3 more": the biggest losses first, plural-free in every language. */
function formatLosses(losses: unknown, lang: string): string {
  const entries = Object.entries(asDict(losses))
    .map(([name, n]) => [name, count(n)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return "";
  const shown = entries.slice(0, 3).map(([name, n]) => `${prettyName(name)} ×${n}`);
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
  for (const body of bodies) {
    if (!body || typeof body.name !== "string" || seen.has(body.name)) continue;
    seen.add(body.name);
    const planet = prettyName(body.name);
    const problems: string[] = [];
    const turrets = states[entityId(serverId, "sensor", "turrets_no_ammo", body.name)];
    const noAmmo = count(turrets?.state);
    if (noAmmo > 0) problems.push(t(lang, "turrets_no_ammo", { count: noAmmo }));
    const noPower = count(asDict(turrets?.attributes).no_power);
    if (noPower > 0) problems.push(t(lang, "turrets_no_power", { count: noPower }));
    const damaged = count(states[entityId(serverId, "sensor", "walls_damaged", body.name)]?.state);
    if (damaged > 0) problems.push(t(lang, "walls_damaged", { count: damaged }));

    const attack = states[entityId(serverId, "binary_sensor", "under_attack", body.name)];
    if (attack?.state === "on") {
      const attrs = asDict(attack.attributes);
      // since_tick cannot be turned into wall time; the entity's last change is when the attack began.
      const since = typeof attack.last_changed === "string" ? Date.parse(attack.last_changed) : NaN;
      const minutes = Number.isFinite(since) ? Math.floor((now - since) / 60_000) : null;
      const title =
        minutes === null
          ? t(lang, "attack_title_now", { planet })
          : t(lang, "attack_title", { planet, minutes: minutes < 1 ? "<1" : minutes });
      const lines: CalloutLine[] = [];
      const losses = formatLosses(attrs.losses, lang);
      if (losses) lines.push({ text: t(lang, "attack_losses", { list: losses }), tone: "text" });
      const pos = asList(attrs.position);
      if (pos.length >= 2 && isNum(pos[0]) && isNum(pos[1]))
        lines.push({ text: t(lang, "attack_near", { position: `[${Math.round(pos[0])}, ${Math.round(pos[1])}]` }), tone: "muted" });
      for (const text of problems) lines.push({ text, tone: "amber" });
      out.push({ body: body.name, tone: "attack", title, lines });
    } else if (problems.length > 0) {
      out.push({
        body: body.name,
        tone: "warning",
        title: t(lang, "defense_title", { planet }),
        lines: problems.map((text) => ({ text, tone: "text" as const })),
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
}

function measure(item: CalloutInput, body: Placed, maxWidth: number): Sized {
  const width = Math.min(
    maxWidth,
    Math.max(MIN_WIDTH, Math.ceil(Math.max(item.title.length * TITLE_CHAR, ...item.lines.map((l) => l.text.length * LINE_CHAR)) + 2 * PAD_X)),
  );
  const inner = width - 2 * PAD_X;
  const title = truncate(item.title, Math.floor(inner / TITLE_CHAR));
  const lines = item.lines.map((l) => ({ ...l, text: truncate(l.text, Math.floor(inner / LINE_CHAR)) }));
  const strip = item.tone === "attack" ? HAZARD_STRIP : 0;
  const baselines = [strip + 25];
  lines.forEach((_, k) => baselines.push(strip + 25 + 21 + k * 19));
  const height = baselines[baselines.length - 1] + 13;
  return { item: { ...item, title, lines }, body, width, height, baselines };
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

/** Two lead lines cross (touching ends do not count). */
function leadsCross(a: Line, b: Line): boolean {
  const side = (p: Line, x: number, y: number): number => Math.sign((p.x2 - p.x1) * (y - p.y1) - (p.y2 - p.y1) * (x - p.x1));
  return side(a, b.x1, b.y1) * side(a, b.x2, b.y2) < 0 && side(b, a.x1, a.y1) * side(b, a.x2, a.y2) < 0;
}

/** From the edge of the body to the facing edge of the box. */
function leadLine(s: Sized, x: number, y: number, band: "top" | "bottom"): Line {
  const top = band === "top";
  return {
    x1: s.body.cx,
    y1: top ? s.body.cy - s.body.r : s.body.cy + s.body.r,
    x2: Math.min(Math.max(s.body.cx, x + 12), x + s.width - 12),
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
  const labels = size.labels ?? placed.map((p) => labelRect(p));
  const result: Callout[] = [];
  const overflow: Sized[] = [];
  const make = (s: Sized, x: number, y: number, band: "top" | "bottom"): Callout => ({
    ...s.item,
    x,
    y,
    width: s.width,
    height: s.height,
    band,
    baselines: s.baselines.map((b) => y + b),
    line: leadLine(s, x, y, band),
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
    const line = leadLine(s, x, y, band);
    return Math.hypot(Math.max(0, gap), Math.abs(x - preferred)) + CROSSING_COST * crossings(line, placed, s.item.body);
  };
  const assigned = items
    .filter((item) => byName.has(item.body))
    .map((item) => {
      const body = byName.get(item.body)!;
      const own = body.cy < size.height / 2 ? "top" : "bottom";
      const other = own === "top" ? "bottom" : "top";
      const s = measure(item, body, spanOf(own));
      const alt = measure(item, body, spanOf(other));
      // The band of the body's half, unless its extent (summary, legend) makes the other band's lead shorter.
      return lead(alt, other) < lead(s, own) ? { band: other, s: alt } : { band: own, s };
    });
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
        // Tier 2: covers no body or label, its lead crosses no body or lead; 1: covers nothing; 0: anything.
        const fits = (x: number, tier: number): boolean => {
          const box = { x, y, width: s.width, height: s.height };
          const others = [...result, ...row];
          if (others.some((c) => boxesOverlap(box, c, BOX_GAP))) return false;
          if (tier >= 1 && (placed.some((p) => boxHitsBody(box, p)) || labels.some((l) => boxHitsLabel(box, l)))) return false;
          if (tier < 2) return true;
          const line = leadLine(s, x, y, band);
          return crossings(line, placed, s.item.body) === 0 && !others.some((c) => leadsCross(line, c.line));
        };
        // A box strays only so far from its body; farther than that, the next row is better.
        const reach = row.length === 0 ? span : Math.min(span, reachOf(s));
        let x: number | null = null;
        for (const tier of [2, 1, 0]) {
          for (let step = 0; step <= reach && x === null; step += 20)
            // Boxes already in the row belong to bodies on the left: going right keeps the leads from crossing.
            for (const cand of step === 0 ? [preferred] : row.length > 0 ? [preferred + step, preferred - step] : [preferred - step, preferred + step])
              if (cand >= lo - 1e-6 && cand <= hi + 1e-6 && fits(cand, tier)) {
                x = cand;
                break;
              }
          if (x !== null) break;
        }
        if (x !== null) row.push(make(s, x, y, band));
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
    result.push(make(s, x, y, y + s.height / 2 < s.body.cy ? "top" : "bottom"));
  }
  return result;
}
