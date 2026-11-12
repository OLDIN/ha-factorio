export interface TimelineCardConfig {
  type?: string;
  server_id: string;
  /** Length of the shown window in minutes (5–60, default 60: the sensor keeps one hour). */
  window_minutes?: number;
}

export const DEFAULT_WINDOW = 60;
export const MIN_WINDOW = 5;
export const MAX_WINDOW = 60;

/** The configured window, clamped to 5–60; anything that is not a number gives the default. */
export function windowMinutes(config: TimelineCardConfig | undefined): number {
  const raw: unknown = config?.window_minutes;
  const w = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(w) ? Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, w)) : DEFAULT_WINDOW;
}
