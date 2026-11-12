/** Epoch ms of an event time; the sensor sends UTC, so a timestamp without Z or an offset is UTC; NaN if unusable. */
export function parseTime(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const text = value.trim();
  const naive = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(text);
  return Date.parse(naive ? `${text.replace(" ", "T")}Z` : text);
}
