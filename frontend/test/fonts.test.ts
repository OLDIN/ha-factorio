import { describe, expect, it } from "vitest";
import { fontFaceCss } from "../src/shared/theme";

describe("fontFaceCss", () => {
  const css = fontFaceCss();
  it("self-hosts all faces without third-party hosts", () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css.match(/@font-face/g)).toHaveLength(12);
    expect(css).toContain('/factorio_static/fonts/golos-text-cyrillic-600-normal.woff2');
    expect(css).toContain("unicode-range:U+0301,U+0400-045F");
  });
});
