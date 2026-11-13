/**
 * Space platforms on the system map, pure: a diamond on the line between the bodies of a flying
 * platform (with a dashed route between their edges), and a short arc of diamonds next to the
 * body a platform stands at.
 */
import { t } from "../shared/i18n";
import { bodyName } from "../shared/names";
import { platformTone, platformWhere, type PlatformRow } from "../shared/platforms";
import { lineFact, lossItems, type Popup, type PopupFact } from "./popups";
import type { Placed } from "./layout";

export interface PlatformMark {
  index: number;
  x: number;
  y: number;
  tone: "red" | "amber" | "cyan" | "muted";
  title: string;
}

/** A platform with a problem (damage or a stopped line) pulses on the map and has a popup. */
export const hasProblem = (m: Pick<PlatformMark, "tone">): boolean => m.tone === "red" || m.tone === "amber";

/** The popup state key of a platform; body names never start with "#". */
export const platformKey = (index: number): string => `#pf:${index}`;

/** What the popup of a platform says when something is wrong: damage (red) and / or stopped lines (amber); null when nothing is. */
export function platformAlert(r: PlatformRow, lang: string): Popup | null {
  if (!r.damage && r.lines.length === 0) return null;
  const facts: PopupFact[] = [];
  const lost = r.damage ? lossItems(r.damage.losses, lang) : [];
  if (lost.length > 0) facts.push({ label: t(lang, "st_lost"), value: lost });
  facts.push(...r.lines.map((l) => lineFact(l, lang)));
  if (r.linesMore > 0) facts.push({ label: t(lang, "pl_more", { count: r.linesMore }), value: "" });
  const stopped = r.lines.length + r.linesMore;
  return {
    body: r.location ?? r.route?.to ?? "",
    tone: r.damage ? "attack" : "warning",
    title: t(lang, "pf_name", { name: r.name }),
    swatch: "platform",
    chip: r.damage ? t(lang, "chip_damaged") : stopped === 1 ? t(lang, "chip_line") : t(lang, "chip_lines", { count: stopped }),
    facts,
    checks: [...(r.damage ? [] : [t(lang, "ck_nodamage")]), ...(stopped === 0 ? [t(lang, "ck_lines")] : [])],
  };
}

/** The popup of a platform: what is wrong with it, else where it is, with the checks that passed. */
export function platformPopup(r: PlatformRow, lang: string): Popup {
  const alert = platformAlert(r, lang);
  if (alert !== null) return alert;
  const facts: PopupFact[] = [];
  const where = platformWhere(r, lang);
  if (where !== null) facts.push({ label: t(lang, "st_state"), value: where });
  if (r.route) {
    const percent = Math.round(r.route.progress * 100);
    facts.push({ label: t(lang, "st_state"), value: t(lang, "pf_flying") });
    facts.push({ label: t(lang, "st_route"), value: `${bodyName(r.route.from, lang)} → ${bodyName(r.route.to, lang)}` });
    facts.push({ label: t(lang, "st_progress"), value: `${percent}%`, bar: { percent, style: "segments" } });
  }
  return {
    body: r.location ?? r.route?.to ?? "",
    tone: "ok",
    title: t(lang, "pf_name", { name: r.name }),
    swatch: "platform",
    chip: t(lang, "st_all_well"),
    facts,
    checks: [t(lang, "ck_nodamage"), t(lang, "ck_lines")],
  };
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
  // Damaged and problem platforms first, so they always get a place in the stack.
  for (const [name, unsorted] of standing) {
    const list = [...unsorted].sort((x, y) => Number(hasProblem({ tone: platformTone(y) })) - Number(hasProblem({ tone: platformTone(x) })));
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
