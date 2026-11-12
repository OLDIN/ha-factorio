/**
 * Where the hover / pinned popup of a planet goes: next to the body and always inside the map,
 * with a lead line from the edge of the body to the nearest point of the popup. Pure.
 */

export interface PopupPlace {
  x: number;
  y: number;
  /** The size the popup gets: never larger than the map minus its margins. */
  width: number;
  height: number;
  /** From the edge of the body to the popup; null when the popup touches the body. */
  line: { x1: number; y1: number; x2: number; y2: number } | null;
}

export const POPUP_MARGIN = 8;
const GAP = 14; // between the body and the popup
const TITLE_OFFSET = 24; // the popup title sits about level with the body

/**
 * To the right of the body, else to the left, else below, else above; clamped to the map.
 * `size` is the popup as measured (or a guess before the first measurement).
 */
export function placePopup(
  body: { cx: number; cy: number; r: number },
  area: { width: number; height: number },
  size: { width: number; height: number },
): PopupPlace {
  const m = POPUP_MARGIN;
  const width = Math.max(0, Math.min(size.width, area.width - 2 * m));
  const height = Math.max(0, Math.min(size.height, area.height - 2 * m));
  const clampX = (x: number): number => Math.min(Math.max(x, m), area.width - width - m);
  const clampY = (y: number): number => Math.min(Math.max(y, m), area.height - height - m);
  const right = body.cx + body.r + GAP;
  const left = body.cx - body.r - GAP - width;
  let x: number;
  let y: number;
  if (right + width <= area.width - m) {
    x = right;
    y = clampY(body.cy - TITLE_OFFSET);
  } else if (left >= m) {
    x = left;
    y = clampY(body.cy - TITLE_OFFSET);
  } else {
    x = clampX(body.cx - width / 2);
    const below = body.cy + body.r + GAP;
    const above = body.cy - body.r - GAP - height;
    y = below + height <= area.height - m ? below : above >= m ? above : clampY(below);
  }
  return { x, y, width, height, line: lead(body, { x, y, width, height }) };
}

function lead(body: { cx: number; cy: number; r: number }, box: { x: number; y: number; width: number; height: number }): PopupPlace["line"] {
  const px = Math.min(Math.max(body.cx, box.x), box.x + box.width);
  const py = Math.min(Math.max(body.cy, box.y), box.y + box.height);
  const dx = px - body.cx;
  const dy = py - body.cy;
  const d = Math.hypot(dx, dy);
  if (d <= body.r + 2) return null;
  return { x1: body.cx + (dx / d) * body.r, y1: body.cy + (dy / d) * body.r, x2: px, y2: py };
}
