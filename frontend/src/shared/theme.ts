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
    --fha-faint: #7f93b3;
    --fha-soft: #c3cede;
    --fha-grid: #12244a;
    --fha-orbit: #1a2f58;
    --fha-cyan-soft: #a6e4ff;
    --fha-red-soft: #ff9a90;
    --fha-red-bg: #22121a;
    --fha-red-border: #7a2a2a;
    --fha-amber-soft: #f8c66a;
    --fha-amber-bg: #1d1a12;
    --fha-amber-border: #7a5a17;
    --fha-sun-core: #fff4cf;
    --fha-sun-mid: #ffc35f;
    --fha-sun-edge: #e9862c;
    --fha-sun-glow: #ffb347;
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
