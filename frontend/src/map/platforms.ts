/**
 * Space platforms on the system map, pure: a diamond on the line between the bodies of a flying
 * platform (with a dashed route between their edges), and a short arc of diamonds next to the
 * body a platform stands at.
 */
import { platformTone, type PlatformRow } from "../shared/platforms";
import type { Placed } from "./layout";

export interface PlatformMark {
  index: number;
  x: number;
  y: number;
  tone: "amber" | "cyan" | "muted";
  title: string;
}

export interface PlatformsLayout {
  diamonds: PlatformMark[];
  routes: { x1: number; y1: number; x2: number; y2: number }[];
  /** "+N" next to a body with more standing platforms than PARKED_MAX. */
  more: { x: number; y: number; count: number }[];
}

/** Standing platforms drawn next to one body; the rest is "+N". */
export const PARKED_MAX = 4;
/** A route starts and ends this far outside the bodies' edges (past their rings). */
const ROUTE_GAP = 8;
/** Standing platforms sit on an arc this far outside the body's edge (past rings and pulse). */
const ARC_GAP = 14;
const ARC_STEP = 13; // px between diamonds along the arc
const ARC_START = Math.PI / 5; // lower right of the body (SVG y grows downwards)

/** Where to draw the platforms; platforms whose bodies are not on the map are left out. */
export function placePlatforms(rows: PlatformRow[], placed: Placed[], title: (r: PlatformRow) => string): PlatformsLayout {
  const byName = new Map(placed.map((p) => [p.name, p]));
  const out: PlatformsLayout = { diamonds: [], routes: [], more: [] };
  const standing = new Map<string, PlatformRow[]>();
  for (const r of rows) {
    if (r.route) {
      const a = byName.get(r.route.from);
      const b = byName.get(r.route.to);
      if (!a || !b) continue;
      const dx = b.cx - a.cx;
      const dy = b.cy - a.cy;
      const d = Math.hypot(dx, dy);
      if (d > a.r + b.r + 2 * ROUTE_GAP) {
        const ux = dx / d;
        const uy = dy / d;
        out.routes.push({
          x1: a.cx + ux * (a.r + ROUTE_GAP),
          y1: a.cy + uy * (a.r + ROUTE_GAP),
          x2: b.cx - ux * (b.r + ROUTE_GAP),
          y2: b.cy - uy * (b.r + ROUTE_GAP),
        });
      }
      const t = r.route.progress;
      out.diamonds.push({ index: r.index, x: a.cx + dx * t, y: a.cy + dy * t, tone: platformTone(r), title: title(r) });
    } else if (r.location !== null && byName.has(r.location)) {
      const list = standing.get(r.location) ?? [];
      list.push(r);
      standing.set(r.location, list);
    }
  }
  // Damaged and problem platforms (amber) first, so they always get a place in the stack.
  for (const [name, unsorted] of standing) {
    const list = [...unsorted].sort((x, y) => Number(platformTone(y) === "amber") - Number(platformTone(x) === "amber"));
    const p = byName.get(name)!;
    const radius = p.r + ARC_GAP;
    const at = (k: number): { x: number; y: number } => {
      const angle = ARC_START + (k * ARC_STEP) / radius;
      return { x: p.cx + Math.cos(angle) * radius, y: p.cy + Math.sin(angle) * radius };
    };
    list.slice(0, PARKED_MAX).forEach((r, k) => out.diamonds.push({ index: r.index, ...at(k), tone: platformTone(r), title: title(r) }));
    if (list.length > PARKED_MAX) out.more.push({ ...at(PARKED_MAX), count: list.length - PARKED_MAX });
  }
  return out;
}
