import { describe, expect, it } from "vitest";
import { asDict, asList } from "../src/shared/types";
import { entityId, slug } from "../src/shared/entities";
import { planetColor } from "../src/shared/palette";
import { cardStyles } from "../src/shared/theme";
import { t } from "../src/shared/i18n";

describe("entityId", () => {
  it("builds planet entity ids", () => {
    expect(entityId("main", "sensor", "turrets_no_ammo", "nauvis")).toBe(
      "sensor.factorio_main_nauvis_turrets_no_ammo",
    );
  });
  it("builds server and binary_sensor ids", () => {
    expect(entityId("main", "sensor", "bodies")).toBe("sensor.factorio_main_bodies");
    expect(entityId("main", "binary_sensor", "under_attack", "gleba")).toBe(
      "binary_sensor.factorio_main_gleba_under_attack",
    );
  });
  it("slugs like Home Assistant slugify", () => {
    expect(slug("My--Server")).toBe("my_server");
    expect(slug("__a  b__")).toBe("a_b");
    expect(entityId("My--Server", "sensor", "research")).toBe("sensor.factorio_my_server_research");
  });
});

describe("planetColor", () => {
  it("knows vanilla planets", () => {
    expect(planetColor("nauvis")).toBe("#4f9e57");
    expect(planetColor("aquilo")).toBe("#6cbbe8");
  });
  it("is stable for unknown planets", () => {
    expect(planetColor("x")).toBe(planetColor("x"));
    expect(planetColor("x")).toMatch(/^hsl\(\d+, 45%, 62%\)$/);
  });
});

describe("t", () => {
  it("falls back to English for unknown languages", () => {
    expect(t("de", "research")).toBe(t("en", "research"));
  });
  it("translates uk and interpolates", () => {
    expect(t("uk", "research")).not.toBe(t("en", "research"));
    expect(t("en", "turrets_no_ammo", { count: 3 })).toContain("3");
  });
});

describe("helpers", () => {
  it("asDict / asList tolerate empty Lua tables", () => {
    expect(asDict([])).toEqual({});
    expect(asDict({ a: 1 })).toEqual({ a: 1 });
    expect(asDict(null)).toEqual({});
    expect(asList({})).toEqual([]);
    expect(asList([1])).toEqual([1]);
  });
  it("cardStyles carries the default tokens", () => {
    expect(cardStyles.cssText).toContain("--fha-bg: #0a1631");
  });
});
