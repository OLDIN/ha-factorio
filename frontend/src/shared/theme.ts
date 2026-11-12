import { css } from "lit";

export const cardStyles = css`
  :host {
    --fha-bg: #0a1631;
    --fha-panel: #0e1c38;
    --fha-line: #1f3460;
    --fha-text: #edf2f8;
    --fha-muted: #a3b4cf;
    --fha-amber: #f5a524;
    --fha-red: #ff5d4f;
    --fha-green: #4cc38a;
    --fha-cyan: #5ccfff;
    display: block;
    color: var(--fha-text);
    font-family: "Golos Text", system-ui, sans-serif;
  }
`;

const FONTS_ID = "factorio-ha-fonts";

/** Adds the Google Fonts stylesheet once. */
export function ensureFonts(): void {
  if (document.getElementById(FONTS_ID)) return;
  const link = document.createElement("link");
  link.id = FONTS_ID;
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Unbounded:wght@500;600;700&family=Golos+Text:wght@400;500;600&display=swap";
  document.head.appendChild(link);
}
