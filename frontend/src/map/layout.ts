/**
 * Pure layout of the system map: where each body, moon and label goes. No Lit, no DOM.
 *
 * The map is "unrolled": the sun is on the left, x grows with the distance of top-level bodies
 * from the sun (gap-capped, see distanceScale), y follows their orientation. Moons sit next to
 * their parent.
 */

/** One entry of the `bodies` attribute; absent fields mean null. */
export interface Body {
  name: string;
  kind?: string | null;
  x?: number | null;
  y?: number | null;
  distance?: number | null;
  orientation?: number | null;
  magnitude?: number | null;
  parent?: string | null;
  state?: string | null;
  unlocked_by?: string | null;
}

export type Anchor = "start" | "middle" | "end";

export interface Placed {
  name: string;
  cx: number;
  cy: number;
  r: number;
  /** Baseline of the first label line. */
  label: { x: number; y: number; anchor: Anchor };
  /** The parent the body is drawn next to (a moon), or null for a top-level body. */
  parent: string | null;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LayoutOptions {
  /** A second label line per body (for example the research progress). */
  sublabels?: Record<string, string>;
  /** Bodies whose labels are not drawn: they take no space. */
  hidden?: ReadonlySet<string>;
  /** Areas bodies and labels keep away from (the summary, the legend). */
  obstacles?: Rect[];
}

/** Side margin of the distance axis. */
export const MARGIN_X = 80;
/** On the distance axis a gap between neighbouring distances is at most this many median gaps. */
export const GAP_CAP = 3;
/** Row height of the legend. */
export const LEGEND_ROW = 21;
/** Label font sizes; a label is about `characters × 7.5` px wide at 13 px. */
export const LABEL_FONT = 13;
export const MOON_LABEL_FONT = 11;
const CHAR_WIDTH_13 = 7.5;
/** Moons are drawn this far (centre to centre) beyond their parent's radius. */
export const MOON_OFFSET = 14;
/** Rings drawn around a top-level body (status, research, attack) reach this far beyond its radius. */
export const RING_ALLOWANCE = 7;
const MOON_RING_ALLOWANCE = 3;
/** Free space between the drawn outlines of two bodies. */
const GAP = 8;
const ITERATIONS = 50;
/** Free space between a body (rings included) and an obstacle. */
const KEEP_OUT_PAD = 4;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const mod1 = (v: number): number => ((v % 1) + 1) % 1;

/** "solar-system-edge" → "Solar system edge" (localised game names come later). */
export function prettyName(name: string): string {
  const text = name.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function textWidth(text: string, font: number): number {
  return text.length * CHAR_WIDTH_13 * (font / LABEL_FONT);
}

/** Radius of a top-level body: built ones grow with magnitude. */
export function bodyRadius(body: Body): number {
  if (body.state === "built") return clamp(12 + (isNum(body.magnitude) ? body.magnitude : 1) * 6, 12, 22);
  return body.state === "unlocked" ? 9 : 8;
}

/** Moons are small dots next to their parent, as in the mockup (r ≤ 10 keeps them clear of it). */
export function moonRadius(body: Body): number {
  return body.state === "built" ? 6 : 5;
}

/** Vertical band where top-level bodies go; above and below it are the callout bands. */
export function plotBand(size: Size): { top: number; bottom: number } {
  // Never above y = 110: the summary takes the top-left corner.
  const top = clamp(size.height * 0.19, 110, 130);
  const bottom = size.height - clamp(size.height * 0.23, 80, 150);
  return { top, bottom: Math.max(bottom, top) };
}

/** The legend in the bottom-right corner: icon column at `x`, first baseline at `y`, and the box it takes. */
export function legendLayout(size: Size, texts: string[]): { x: number; y: number; rect: Rect } {
  const width = 28 + Math.max(0, ...texts.map((text) => text.length * 6.3));
  const x = size.width - width - 20;
  const y = size.height - 18 - (texts.length - 1) * LEGEND_ROW;
  return { x, y, rect: { x0: x - 12, y0: y - 14, x1: size.width, y1: size.height } };
}

/** The sun: a big disc off the left edge, its visible rim at x = 40. */
export function sunGeometry(size: Size): { cx: number; cy: number; r: number } {
  const r = size.height * 0.47;
  return { cx: 40 - r, cy: size.height / 2, r };
}

export function labelFont(p: Placed): number {
  return p.parent === null ? LABEL_FONT : MOON_LABEL_FONT;
}

/** Box of a label as drawn: first line at `label.y`, an optional smaller second line below it. */
export function labelRect(p: Placed, sublabel?: string): Rect {
  const font = labelFont(p);
  const subFont = font - 1;
  const width = Math.max(textWidth(prettyName(p.name), font), sublabel ? textWidth(sublabel, subFont) : 0);
  const x0 = p.label.anchor === "start" ? p.label.x : p.label.anchor === "end" ? p.label.x - width : p.label.x - width / 2;
  const bottom = sublabel ? p.label.y + font + 3 + subFont * 0.25 : p.label.y + font * 0.25;
  return { x0, x1: x0 + width, y0: p.label.y - font, y1: bottom };
}

interface Node {
  body: Body;
  name: string;
  parent: number; // index of the parent node, -1 for top-level
  root: number;
  r: number;
  halo: number; // radius of what is drawn, rings included
  cx: number;
  cy: number;
  dx: number; // offset from the parent (moons)
  dy: number;
}

interface Cluster {
  root: number;
  members: number[]; // parent-first order
  lo: number; // allowed range of the root's cy
  hi: number;
  x0: number; // horizontal extent, for a quick reject
  x1: number;
}

/**
 * Position on the distance axis, 0…1, monotonic in distance (equal distances, equal positions).
 * Neighbouring distinct distances are spaced by their gap, but no gap counts for more than
 * GAP_CAP median gaps: one far body (shattered-planet at 80 next to the rest at ≤ 50) does not
 * squeeze the whole system into a corner.
 */
export function distanceScale(distances: number[]): (d: number) => number {
  const ds = [...new Set(distances.filter(isNum))].sort((a, b) => a - b);
  if (ds.length < 2) return () => 0.5;
  const gaps = ds.slice(1).map((d, i) => d - ds[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const cum = [0];
  gaps.forEach((g, i) => cum.push(cum[i] + Math.min(g, GAP_CAP * median)));
  const total = cum[cum.length - 1];
  return (d) => {
    if (d <= ds[0]) return 0;
    if (d >= ds[ds.length - 1]) return 1;
    let i = 1;
    while (ds[i] < d) i++;
    return (cum[i - 1] + ((d - ds[i - 1]) / (ds[i] - ds[i - 1])) * (cum[i] - cum[i - 1])) / total;
  };
}

function orientationOf(b: Body): number | null {
  if (isNum(b.orientation)) return mod1(b.orientation);
  if (isNum(b.x) && isNum(b.y) && (b.x !== 0 || b.y !== 0)) return mod1(Math.atan2(b.x, -b.y) / (2 * Math.PI));
  return null;
}

function distanceOf(b: Body): number | null {
  if (isNum(b.distance)) return b.distance;
  if (isNum(b.x) && isNum(b.y)) return Math.hypot(b.x, b.y);
  return null;
}

/** Valid bodies, one per name, each parent resolved to an index (-1: top-level). */
function buildNodes(bodies: Body[]): Node[] {
  const nodes: Node[] = [];
  const index = new Map<string, number>();
  for (const body of bodies) {
    if (!body || typeof body.name !== "string" || body.name === "" || index.has(body.name)) continue;
    index.set(body.name, nodes.length);
    nodes.push({ body, name: body.name, parent: -1, root: -1, r: 0, halo: 0, cx: 0, cy: 0, dx: 0, dy: 0 });
  }
  nodes.forEach((node, i) => {
    const p = typeof node.body.parent === "string" ? index.get(node.body.parent) : undefined;
    if (p !== undefined && p !== i) node.parent = p;
  });
  // A cycle of parents (bad data) makes its members top-level.
  for (const node of nodes) {
    const seen = new Set<Node>([node]);
    let cur = node;
    while (cur.parent >= 0) {
      cur = nodes[cur.parent];
      if (seen.has(cur)) {
        for (const n of seen) n.parent = -1;
        break;
      }
      seen.add(cur);
    }
  }
  nodes.forEach((node) => {
    let cur = node;
    while (cur.parent >= 0) cur = nodes[cur.parent];
    node.root = nodes.indexOf(cur);
    const moon = node.parent >= 0;
    node.r = moon ? moonRadius(node.body) : bodyRadius(node.body);
    node.halo = node.r + (moon ? MOON_RING_ALLOWANCE : RING_ALLOWANCE);
  });
  return nodes;
}

/** Moons at `r_parent + 14` from the parent's centre, at the angle of their orientation; siblings that would touch are spread. */
function placeMoons(nodes: Node[]): void {
  const children = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    if (n.parent >= 0) children.set(n.parent, [...(children.get(n.parent) ?? []), i]);
  });
  for (const [parentIdx, kids] of children) {
    const dist = nodes[parentIdx].r + MOON_OFFSET;
    const items = kids
      .map((i) => ({ i, a: 2 * Math.PI * (orientationOf(nodes[i].body) ?? 0.25) }))
      .sort((p, q) => p.a - q.a || nodes[p.i].name.localeCompare(nodes[q.i].name));
    const need = (a: number, b: number): number =>
      2 * Math.asin(Math.min(1, (nodes[a].halo + nodes[b].halo + 2) / (2 * dist)));
    for (let k = 1; k < items.length; k++) {
      const min = items[k - 1].a + need(items[k - 1].i, items[k].i);
      if (items[k].a < min) items[k].a = min;
    }
    if (items.length > 1) {
      const last = items[items.length - 1];
      if (items[0].a + 2 * Math.PI - last.a < need(last.i, items[0].i)) {
        const start = items[0].a; // crowded: spread evenly from the first moon
        items.forEach((it, k) => (it.a = start + (k * 2 * Math.PI) / items.length));
      }
    }
    for (const { i, a } of items) {
      nodes[i].dx = dist * Math.sin(a);
      nodes[i].dy = -dist * Math.cos(a);
    }
  }
}

function positionMembers(nodes: Node[], cluster: Cluster): void {
  for (const i of cluster.members) {
    const n = nodes[i];
    if (n.parent < 0) continue;
    n.cx = nodes[n.parent].cx + n.dx;
    n.cy = nodes[n.parent].cy + n.dy;
  }
}

/** Moves a cluster vertically within its range; returns the shift actually applied. */
function moveCluster(nodes: Node[], cluster: Cluster, by: number): number {
  const root = nodes[cluster.root];
  const applied = clamp(root.cy + by, cluster.lo, cluster.hi) - root.cy;
  if (applied !== 0) for (const i of cluster.members) nodes[i].cy += applied;
  return applied;
}

/** The vertical shift that separates `b` from `a` (dir 1: b goes down), 0 when they are clear. */
function separation(nodes: Node[], a: Cluster, b: Cluster): { shift: number; dir: number } {
  let best = { shift: 0, dir: 1 };
  if (a.x1 + GAP < b.x0 || b.x1 + GAP < a.x0) return best;
  for (const i of a.members)
    for (const j of b.members) {
      const p = nodes[i];
      const q = nodes[j];
      const need = p.halo + q.halo + GAP;
      const dx = q.cx - p.cx;
      const dy = q.cy - p.cy;
      if (dx * dx + dy * dy >= need * need) continue;
      const shift = Math.sqrt(need * need - dx * dx) - Math.abs(dy);
      if (shift > best.shift) best = { shift, dir: dy > 0 || (dy === 0 && b.root > a.root) ? 1 : -1 };
    }
  return best;
}

const collides = (nodes: Node[], a: Cluster, b: Cluster): boolean => separation(nodes, a, b).shift > 1e-6;

/**
 * Narrows the cluster's vertical range so that none of its bodies (rings included) overlaps an
 * obstacle (the legend, the summary) it shares x with. If the band leaves no room, the cluster
 * may leave the band, but never the card.
 */
function keepOut(nodes: Node[], c: Cluster, obstacles: Rect[], cardLo: number, cardHi: number): void {
  const root = nodes[c.root];
  for (const o of obstacles) {
    // Root heights at which some member would touch the obstacle: the open interval (fa, fb).
    let fa = Infinity;
    let fb = -Infinity;
    for (const i of c.members) {
      const n = nodes[i];
      const pad = n.halo + KEEP_OUT_PAD;
      if (n.cx + pad <= o.x0 || n.cx - pad >= o.x1) continue;
      const rel = n.cy - root.cy;
      fa = Math.min(fa, o.y0 - rel - pad);
      fb = Math.max(fb, o.y1 - rel + pad);
    }
    if (fa >= fb || fb <= c.lo || fa >= c.hi) continue;
    const stayAbove = fb >= c.hi || (fa > c.lo && root.cy < (fa + fb) / 2);
    if (stayAbove) {
      c.hi = Math.max(cardLo, fa);
      c.lo = Math.min(c.lo, c.hi);
    } else {
      c.lo = Math.min(cardHi, fb);
      c.hi = Math.max(c.hi, c.lo);
    }
  }
}

function pushApart(nodes: Node[], clusters: Cluster[]): void {
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const { shift, dir } = separation(nodes, clusters[i], clusters[j]);
        if (shift <= 1e-6) continue;
        // Each moves half the way; what one cannot do (edge of the band) the other does.
        const total = shift + 0.01;
        const a = Math.abs(moveCluster(nodes, clusters[i], (-dir * total) / 2));
        const b = Math.abs(moveCluster(nodes, clusters[j], dir * (total - a)));
        if (a + b < total) moveCluster(nodes, clusters[i], -dir * (total - a - b));
        moved = true;
      }
    if (!moved) return;
  }
  // Still crowded after the iterations: settle clusters one by one at the nearest free height.
  const order = [...clusters].sort((a, b) => nodes[a.root].cx - nodes[b.root].cx || a.root - b.root);
  const settled: Cluster[] = [];
  for (const c of order) {
    if (settled.some((s) => collides(nodes, s, c))) {
      const start = nodes[c.root].cy;
      let found = false;
      for (let step = 4; step <= c.hi - c.lo + 4 && !found; step += 4)
        for (const sign of [1, -1]) {
          const y = start + sign * step;
          if (y < c.lo - 1e-6 || y > c.hi + 1e-6) continue;
          moveCluster(nodes, c, y - nodes[c.root].cy);
          if (!settled.some((s) => collides(nodes, s, c))) {
            found = true;
            break;
          }
        }
      if (!found) moveCluster(nodes, c, start - nodes[c.root].cy);
    }
    settled.push(c);
  }
}

interface Candidate {
  x: number;
  y: number;
  anchor: Anchor;
}

const rectHitsCircle = (r: Rect, cx: number, cy: number, radius: number): boolean => {
  const nx = clamp(cx, r.x0, r.x1);
  const ny = clamp(cy, r.y0, r.y1);
  return (nx - cx) ** 2 + (ny - cy) ** 2 < radius * radius;
};
const rectsOverlap = (a: Rect, b: Rect, pad: number): boolean =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** Each label takes the first of below, above, right, left (then a few further spots) that is free. */
function placeLabels(nodes: Node[], placed: Placed[], size: Size, opts: LayoutOptions): void {
  const sun = sunGeometry(size);
  const obstacles = opts.obstacles ?? [];
  const hidden = opts.hidden ?? new Set<string>();
  const taken: Rect[] = [];
  const rank = (i: number): number =>
    (opts.sublabels?.[placed[i].name] ? 0 : 4) + (placed[i].parent === null ? 0 : 2) + (nodes[i].body.state === "built" ? 0 : 1);
  const order = placed.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || placed[a].cx - placed[b].cx || a - b);

  for (const i of order) {
    const p = placed[i];
    const font = labelFont(p);
    const h = nodes[i].halo;
    if (hidden.has(p.name)) {
      p.label = { x: p.cx, y: p.cy + h + 3 + font, anchor: "middle" };
      continue;
    }
    const sub = opts.sublabels?.[p.name];
    const probe = labelRect({ ...p, label: { x: 0, y: 0, anchor: "start" } }, sub);
    const below = probe.y1; // block height under the first baseline
    const middle = p.cy - (probe.y1 - probe.y0) / 2 + font;
    const d = h * 0.7;
    const candidates: Candidate[] = [
      { x: p.cx, y: p.cy + h + 3 + font, anchor: "middle" },
      { x: p.cx, y: p.cy - h - 3 - below, anchor: "middle" },
      { x: p.cx + h + 5, y: middle, anchor: "start" },
      { x: p.cx - h - 5, y: middle, anchor: "end" },
      { x: p.cx + d, y: p.cy + d + 2 + font, anchor: "start" },
      { x: p.cx - d, y: p.cy + d + 2 + font, anchor: "end" },
      { x: p.cx + d, y: p.cy - d - 2 - below, anchor: "start" },
      { x: p.cx - d, y: p.cy - d - 2 - below, anchor: "end" },
      { x: p.cx, y: p.cy + h + 17 + font, anchor: "middle" },
      { x: p.cx, y: p.cy - h - 17 - below, anchor: "middle" },
      { x: p.cx + h + 18, y: middle, anchor: "start" },
      { x: p.cx - h - 18, y: middle, anchor: "end" },
    ];
    let best: { c: Candidate; rect: Rect; score: number } | null = null;
    for (const c of candidates) {
      const rect = labelRect({ ...p, label: c }, sub);
      let score = 0;
      if (rect.x0 < 2 || rect.y0 < 2 || rect.x1 > size.width - 2 || rect.y1 > size.height - 2) score += 1000;
      for (const t of taken) if (rectsOverlap(rect, t, 2)) score += 100;
      for (const o of obstacles) if (rectsOverlap(rect, o, 2)) score += 1000; // like the card edge
      for (const n of nodes) {
        if (rectHitsCircle(rect, n.cx, n.cy, n.r + 1)) score += 100;
        else if (rectHitsCircle(rect, n.cx, n.cy, n.halo)) score += 1;
      }
      if (rectHitsCircle(rect, sun.cx, sun.cy, sun.r + 6)) score += 50;
      if (!best || score < best.score) best = { c, rect, score };
      if (score === 0) break;
    }
    p.label = { ...best!.c };
    taken.push(best!.rect);
  }
}

/**
 * Positions of all bodies on a map of `size`. Top-level bodies: x by distance (gap-capped scale,
 * 80 px margins), y by orientation, then pushed apart vertically; moons next to their parent.
 */
export function layoutBodies(bodies: Body[], size: Size, opts: LayoutOptions = {}): Placed[] {
  const nodes = buildNodes(bodies);
  if (nodes.length === 0) return [];
  const { top, bottom } = plotBand(size);
  const tops = nodes.filter((n) => n.parent < 0);

  const dists = tops.map((n) => distanceOf(n.body)).filter(isNum);
  const dmin = dists.length ? Math.min(...dists) : 0;
  const scale = distanceScale(dists);
  const ors = tops.map((n) => orientationOf(n.body)).filter(isNum);
  const omin = ors.length ? Math.min(...ors) : 0;
  const omax = ors.length ? Math.max(...ors) : 0;
  for (const n of tops) {
    const d = distanceOf(n.body) ?? dmin;
    const o = orientationOf(n.body);
    n.cx = MARGIN_X + scale(d) * (size.width - 2 * MARGIN_X);
    n.cy = o !== null && omax > omin ? top + ((o - omin) / (omax - omin)) * (bottom - top) : (top + bottom) / 2;
  }

  placeMoons(nodes);
  const clusters: Cluster[] = [];
  const byRoot = new Map<number, Cluster>();
  nodes.forEach((n, i) => {
    if (n.parent >= 0) return;
    const c: Cluster = { root: i, members: [], lo: top, hi: bottom, x0: 0, x1: 0 };
    clusters.push(c);
    byRoot.set(i, c);
  });
  const depth = (i: number): number => (nodes[i].parent < 0 ? 0 : 1 + depth(nodes[i].parent));
  nodes
    .map((_, i) => i)
    .sort((a, b) => depth(a) - depth(b) || a - b)
    .forEach((i) => byRoot.get(nodes[i].root)!.members.push(i));
  for (const c of clusters) {
    positionMembers(nodes, c);
    const root = nodes[c.root];
    let up = 0;
    let down = 0;
    c.x0 = Infinity;
    c.x1 = -Infinity;
    for (const i of c.members) {
      const n = nodes[i];
      up = Math.max(up, root.cy - (n.cy - n.r));
      down = Math.max(down, n.cy + n.r - root.cy);
      c.x0 = Math.min(c.x0, n.cx - n.halo);
      c.x1 = Math.max(c.x1, n.cx + n.halo);
    }
    // The whole cluster (moons included) stays on the card.
    const cardLo = up + 2;
    const cardHi = size.height - down - 2;
    c.lo = Math.max(top, cardLo);
    c.hi = Math.min(bottom, cardHi);
    if (c.lo > c.hi) c.lo = c.hi = (c.lo + c.hi) / 2;
    keepOut(nodes, c, opts.obstacles ?? [], cardLo, cardHi);
    moveCluster(nodes, c, 0);
  }

  pushApart(nodes, clusters);

  const placed: Placed[] = nodes.map((n) => ({
    name: n.name,
    cx: n.cx,
    cy: n.cy,
    r: n.r,
    label: { x: n.cx, y: n.cy, anchor: "middle" as Anchor },
    parent: n.parent < 0 ? null : nodes[n.parent].name,
  }));
  placeLabels(nodes, placed, size, opts);
  return placed;
}
