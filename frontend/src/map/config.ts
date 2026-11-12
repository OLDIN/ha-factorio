export interface MapCardConfig {
  type?: string;
  server_id: string;
  /** Height of the map in px (360–1200, default 640). */
  height?: number;
  /** Label bodies that have no alerts (default true); off: only alerts and research are labelled. */
  label_healthy?: boolean;
}

export const DEFAULT_HEIGHT = 640;
export const MIN_HEIGHT = 360;
export const MAX_HEIGHT = 1200;

/** The configured height, clamped to 360–1200; anything that is not a number gives the default. */
export function mapHeight(config: MapCardConfig | undefined): number {
  const raw: unknown = config?.height;
  const h = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(h) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h))) : DEFAULT_HEIGHT;
}
