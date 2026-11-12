import { vi } from "vitest";

// happy-dom cannot load the Google Fonts stylesheet and logs an error for it; fonts are irrelevant here.
vi.mock("../src/shared/theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/theme")>()),
  ensureFonts: () => {},
}));
