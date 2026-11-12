const VANILLA: Record<string, string> = {
  nauvis: "#4f9e57",
  vulcanus: "#e2703a",
  fulgora: "#9a6bd8",
  gleba: "#b3c63f",
  aquilo: "#6cbbe8",
};

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function planetColor(name: string): string {
  return VANILLA[name] ?? `hsl(${fnv1a(name) % 360}, 45%, 62%)`;
}
