/** Lua serialises an empty table as [] (or {}); anything but a plain object is empty. */
export function asDict<T = unknown>(value: unknown): Record<string, T> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, T>)
    : {};
}

/** Lua serialises an empty table as {} (or []); anything but an array is empty. */
export function asList<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export interface HassState {
  state: string;
  attributes: Record<string, unknown>;
  /** ISO time of the last state change (Home Assistant always sets it). */
  last_changed?: string;
}

export interface Hass {
  states: Record<string, HassState | undefined>;
  language?: string;
  locale?: { language?: string };
}
