import { vi } from "vitest";

// happy-dom would try to fetch the font files; fonts are irrelevant here (fontFaceCss is tested directly).
vi.mock("../src/shared/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/theme")>()),
  ensureFonts: () => {},
}));
