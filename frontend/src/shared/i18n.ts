type Dict = Record<string, string>;

const STRINGS: Record<string, Dict> = {
  en: {
    research: "Research",
    bodies: "Space bodies",
    defense: "Defense",
    under_attack: "Under attack",
    evolution: "Evolution",
    turrets_no_ammo: "{count} turrets out of ammo",
    walls_damaged: "{count} damaged walls",
    no_data: "No data",
  },
  uk: {
    research: "Дослідження",
    bodies: "Космічні тіла",
    defense: "Оборона",
    under_attack: "Напад",
    evolution: "Еволюція",
    turrets_no_ammo: "Турелей без набоїв: {count}",
    walls_damaged: "Пошкоджених стін: {count}",
    no_data: "Немає даних",
  },
};

/** Translate `key` for `lang` (`uk` or `en`; any other language falls back to English). */
export function t(lang: string, key: string, vars: Record<string, string | number> = {}): string {
  const code = lang.toLowerCase().split(/[-_]/)[0];
  const text = STRINGS[code]?.[key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
