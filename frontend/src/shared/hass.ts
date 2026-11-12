import { slug } from "./entities";
import type { Hass } from "./types";

/** The user's language: the profile locale first, then the server language. */
export function langOf(hass?: Hass): string {
  return hass?.locale?.language ?? hass?.language ?? "en";
}

/**
 * HA sets `hass` on every state change anywhere: true when the language or any entity of
 * the Factorio server `sid` changed (or appeared, or went away).
 */
export function serverChanged(old: Hass, hass: Hass, sid: string): boolean {
  if (langOf(old) !== langOf(hass)) return true;
  const prefixes = [`sensor.factorio_${slug(sid)}_`, `binary_sensor.factorio_${slug(sid)}_`];
  for (const id of new Set([...Object.keys(old.states), ...Object.keys(hass.states)]))
    if (prefixes.some((p) => id.startsWith(p)) && old.states[id] !== hass.states[id]) return true;
  return false;
}

/** The server id of the first `sensor.factorio_<id>_<suffix>` entity, or "". */
export function findServer(hass: Hass | undefined, suffix: string): string {
  const re = new RegExp(`^sensor\\.factorio_(.+)_${suffix}$`);
  for (const id of Object.keys(hass?.states ?? {})) {
    const match = re.exec(id);
    if (match) return match[1];
  }
  return "";
}
