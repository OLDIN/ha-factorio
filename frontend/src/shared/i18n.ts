type Dict = Record<string, string>;

const STRINGS: Record<string, Dict> = {
  en: {
    research: "Research",
    bodies: "Space bodies",
    defense: "Defense",
    under_attack: "Under attack",
    evolution: "Evolution",
    turrets_no_ammo: "{count} turrets without ammo",
    turrets_no_power: "{count} turrets without power",
    walls_damaged: "{count} damaged walls",
    no_data: "No data",
    attack_title: "Attack on {planet}: {minutes} min",
    attack_title_now: "Attack on {planet}",
    attack_title_frozen: "Attack on {planet}, {state}",
    game_paused: "game paused",
    game_stopped: "game stopped",
    game_no_connection: "no connection",
    attack_losses: "Lost: {list}",
    attack_more: "+{count} more",
    attack_near: "near {position}",
    defense_title: "{planet}: defense",
    research_progress: "researching {progress}%",
    map_title: "System map",
    map_bodies_one: "{count} body in the system",
    map_bodies_other: "{count} bodies in the system",
    map_breakdown: "{built} built, {unlocked} unlocked, {locked} not unlocked yet",
    map_no_bodies: "No bodies yet: waiting for data from the game",
    map_no_server: "Set server_id in the card settings",
    legend_built: "built",
    legend_unlocked: "unlocked, nothing built",
    legend_locked: "not unlocked yet",
    legend_research: "being researched",
    legend_attack: "attack",
    editor_server_id: "Server ID",
    editor_height: "Height (px)",
    editor_label_healthy: "Label bodies without alerts",
    editor_window_minutes: "Window (minutes)",
    tl_title: "Last hour",
    tl_hint: "recent events get more room",
    tl_all: "All",
    tl_lane_attacks: "Attacks",
    tl_lane_defense: "Defense",
    tl_lane_players_science: "Players & science",
    tl_min: "{n} min",
    tl_now: "now",
    tl_empty: "No events in the last hour",
    tl_no_server: "Set server_id in the card settings",
    tl_more: "+{count} more",
    tl_attack: "{planet}",
    tl_attack_ended: "{planet}, ended",
    tl_no_ammo: "{planet}: {count} without ammo",
    tl_ammo_ok: "{planet}: ammo OK",
    tl_research: "{name}",
    tl_research_level: "{name} {level}",
    tl_joined: "{player} joined",
    tl_left: "{player} left",
    tl_died: "{player} died",
    tl_ago: "{minutes} min ago",
    tl_ago_now: "just now",
  },
  uk: {
    research: "Дослідження",
    bodies: "Космічні тіла",
    defense: "Оборона",
    under_attack: "Напад",
    evolution: "Еволюція",
    turrets_no_ammo: "Турелей без набоїв: {count}",
    turrets_no_power: "Турелей без енергії: {count}",
    walls_damaged: "Пошкоджених стін: {count}",
    no_data: "Немає даних",
    attack_title: "{planet}: напад триває {minutes} хв",
    attack_title_now: "{planet}: напад триває",
    attack_title_frozen: "{planet}: напад, {state}",
    game_paused: "гра на паузі",
    game_stopped: "гра зупинена",
    game_no_connection: "немає зв'язку",
    attack_losses: "Втрачено: {list}",
    attack_more: "ще {count}",
    attack_near: "біля {position}",
    defense_title: "{planet}: оборона",
    research_progress: "досліджено {progress}%",
    map_title: "Карта системи",
    map_bodies_one: "{count} тіло в системі",
    map_bodies_few: "{count} тіла в системі",
    map_bodies_many: "{count} тіл у системі",
    map_bodies_other: "{count} тіла в системі",
    map_breakdown: "{built} забудовано, {unlocked} відкрито без забудови, {locked} ще не відкрито",
    map_no_bodies: "Тіл ще немає: чекаємо даних із гри",
    map_no_server: "Вкажіть server_id у налаштуваннях картки",
    legend_built: "забудовано",
    legend_unlocked: "відкрито, нічого не збудовано",
    legend_locked: "ще не відкрито",
    legend_research: "досліджується",
    legend_attack: "напад",
    editor_server_id: "ID сервера",
    editor_height: "Висота (px)",
    editor_label_healthy: "Підписувати тіла без тривог",
    editor_window_minutes: "Вікно (хвилини)",
    tl_title: "Остання година",
    tl_hint: "свіжі події займають більше місця",
    tl_all: "Усі",
    tl_lane_attacks: "Напади",
    tl_lane_defense: "Оборона",
    tl_lane_players_science: "Гравці й наука",
    tl_min: "{n} хв",
    tl_now: "зараз",
    tl_empty: "За останню годину подій немає",
    tl_no_server: "Вкажіть server_id у налаштуваннях картки",
    tl_more: "ще {count}",
    tl_attack: "{planet}",
    tl_attack_ended: "{planet}, завершено",
    tl_no_ammo: "{planet}: {count} без набоїв",
    tl_ammo_ok: "{planet}: набої є",
    tl_research: "{name}",
    tl_research_level: "{name} {level}",
    tl_joined: "{player} зайшов",
    tl_left: "{player} вийшов",
    tl_died: "{player} загинув",
    tl_ago: "{minutes} хв тому",
    tl_ago_now: "щойно",
  },
};

function langCode(lang: string): string {
  const code = lang.toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(STRINGS, code) ? code : "en";
}

const lookup = (code: string, key: string): string | undefined =>
  Object.hasOwn(STRINGS[code], key) ? STRINGS[code][key] : undefined;

/** Translate `key` for `lang` (`uk` or `en`; any other language falls back to English). */
export function t(lang: string, key: string, vars: Record<string, string | number> = {}): string {
  const text = lookup(langCode(lang), key) ?? lookup("en", key) ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : m));
}

/** Like `t`, with the plural form for `count` (`<key>_one`, `_few`, `_many`, `_other`); `{count}` is set. */
export function tn(lang: string, key: string, count: number, vars: Record<string, string | number> = {}): string {
  const code = langCode(lang);
  let form = "other";
  try {
    form = new Intl.PluralRules(code).select(count);
  } catch {
    // no plural rules available: "other"
  }
  const exists = lookup(code, `${key}_${form}`) !== undefined || lookup("en", `${key}_${form}`) !== undefined;
  return t(lang, exists ? `${key}_${form}` : `${key}_other`, { count, ...vars });
}
