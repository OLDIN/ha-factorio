import { t } from "./i18n";

/** "planet-discovery-gleba" → "Planet discovery gleba": the game id made readable. */
export function prettyName(name: string): string {
  const text = name.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Ukrainian names of the vanilla bodies; mod bodies keep their id (as in the AB-1 mockup). */
const UK: Record<string, string> = {
  nauvis: "Наувіс",
  vulcanus: "Вулканус",
  gleba: "Глеба",
  fulgora: "Фульгора",
  aquilo: "Аквіло",
  "solar-system-edge": "Край сонячної системи",
  "shattered-planet": "Розбита планета",
};

/** Ukrainian names that decline after «на» (the accusative); the rest stay as they are. */
const UK_ACCUSATIVE: Record<string, string> = {
  gleba: "Глебу",
  fulgora: "Фульгору",
};

/** Display name of a space body for `lang`. */
export function bodyName(name: string, lang: string): string {
  const uk = lang.toLowerCase().split(/[-_]/)[0] === "uk";
  return uk && Object.hasOwn(UK, name) ? UK[name] : prettyName(name);
}

/** Display name of a technology: planet discoveries name their planet, the rest is the prettified id. */
export function researchName(id: string, lang: string): string {
  const planet = /^planet-discovery-(.+)$/.exec(id)?.[1];
  return planet ? t(lang, "rs_discovery", { planet: bodyName(planet, lang) }) : prettyName(id);
}

/** The name in the accusative, for «Напад на …»: only the Ukrainian names of the vanilla planets decline. */
export function bodyNameAccusative(name: string, lang: string): string {
  const uk = lang.toLowerCase().split(/[-_]/)[0] === "uk";
  return uk && Object.hasOwn(UK_ACCUSATIVE, name) ? UK_ACCUSATIVE[name] : bodyName(name, lang);
}
