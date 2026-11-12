export type Platform = "sensor" | "binary_sensor";

/** Same as Home Assistant's slugify for ASCII ids: lowercase, runs of non [a-z0-9] become one "_", trimmed. */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function entityId(serverId: string, platform: Platform, key: string, planet?: string): string {
  const parts = ["factorio", serverId, ...(planet === undefined ? [] : [planet]), key].map(slug);
  return `${platform}.${parts.join("_")}`;
}
