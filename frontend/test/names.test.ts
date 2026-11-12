import { describe, expect, it } from "vitest";
import { bodyName, bodyNameAccusative, bodyNameNear, researchName } from "../src/shared/names";

describe("bodyName", () => {
  it("names the vanilla bodies in Ukrainian, as the mockup does", () => {
    expect(bodyName("nauvis", "uk")).toBe("Наувіс");
    expect(bodyName("gleba", "uk-UA")).toBe("Глеба");
    expect(bodyName("shattered-planet", "uk")).toBe("Розбита планета");
  });
  it("keeps mod bodies and other languages as the game id, prettified", () => {
    expect(bodyName("corrundum", "uk")).toBe("Corrundum");
    expect(bodyName("nauvis", "en")).toBe("Nauvis");
    expect(bodyName("solar-system-edge", "de")).toBe("Solar system edge");
  });
  it("has the accusative of the Ukrainian names that decline", () => {
    expect(bodyNameAccusative("gleba", "uk")).toBe("Глебу");
    expect(bodyNameAccusative("fulgora", "uk")).toBe("Фульгору");
    expect(bodyNameAccusative("nauvis", "uk")).toBe("Наувіс");
    expect(bodyNameAccusative("gleba", "en")).toBe("Gleba");
    expect(bodyNameAccusative("corrundum", "uk")).toBe("Corrundum");
  });

  it("has the genitive for «біля …»: vanilla bodies decline, the rest stay", () => {
    expect(bodyNameNear("gleba", "uk")).toBe("Глеби");
    expect(bodyNameNear("nauvis", "uk")).toBe("Наувісу");
    expect(bodyNameNear("aquilo", "uk")).toBe("Аквіло");
    expect(bodyNameNear("solar-system-edge", "uk")).toBe("краю сонячної системи");
    expect(bodyNameNear("corrundum", "uk")).toBe("Corrundum");
    expect(bodyNameNear("gleba", "en")).toBe("Gleba");
  });

  it("names planet discoveries by their planet", () => {
    expect(researchName("planet-discovery-maraxsis", "uk")).toBe("Відкриття планети Maraxsis");
    expect(researchName("planet-discovery-gleba", "uk")).toBe("Відкриття планети Глеба");
    expect(researchName("research-productivity", "uk")).toBe("Research productivity");
  });
});
