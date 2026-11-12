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
    --fha-chip: #10213f;
    --fha-dash: #2f4c7d;
    --fha-green-soft: #6fdca2;
    --fha-green-bg: #10301f;
    --fha-red-chip: #3a1620;
    --fha-amber-chip: #33270f;
    display: block;
    color: var(--fha-text);
    font-family: "Golos Text", system-ui, sans-serif;
  }
`;

/** A panel card of the AB-1 dashboard (planets, players, last hour): rounded box, title row. */
export const panelStyles = css`
  ha-card {
    display: flex;
    flex-direction: column;
    gap: 18px;
    box-sizing: border-box;
    height: 100%;
    overflow: hidden;
    background: var(--fha-panel);
    border: 1px solid var(--fha-line);
    border-radius: var(--ha-card-border-radius, 16px);
    color: var(--fha-text);
    padding: 20px 22px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px 16px;
  }
  h2 {
    margin: 0;
    font: 600 19px "Unbounded", system-ui, sans-serif;
  }
  .hint {
    font-size: 13px;
    color: var(--fha-muted);
  }
  .message {
    color: var(--fha-muted);
  }
`;

const FONTS_ID = "factorio-ha-fonts";
const FONTS_URL = "/factorio_static/fonts";

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const CYRILLIC = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";

/** Self-hosted fonts (served from the integration, OFL): no request leaves for a third party. */
export function fontFaceCss(base: string = FONTS_URL): string {
  const faces: [string, string, number[]][] = [
    ["Unbounded", "unbounded", [500, 600, 700]],
    ["Golos Text", "golos-text", [400, 500, 600]],
  ];
  const out: string[] = [];
  for (const [family, file, weights] of faces) {
    for (const weight of weights) {
      for (const [subset, range] of [
        ["latin", LATIN],
        ["cyrillic", CYRILLIC],
      ] as const) {
        out.push(
          `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;` +
            `src:url("${base}/${file}-${subset}-${weight}-normal.woff2") format("woff2");unicode-range:${range}}`,
        );
      }
    }
  }
  return out.join("\n");
}

/** Adds the @font-face rules once. */
export function ensureFonts(): void {
  if (document.getElementById(FONTS_ID)) return;
  const style = document.createElement("style");
  style.id = FONTS_ID;
  style.textContent = fontFaceCss();
  document.head.appendChild(style);
}
