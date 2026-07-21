const CATEGORY_LABELS: Record<string, string> = {
  heroes_equipment: "Heroes & equipment",
  offense_buildings: "Offense buildings",
  th_weapon: "Town Hall weapon",
  key_defenses: "Key defenses",
  remaining_defenses: "Remaining defenses",
  army_camps: "Army Camps",
  walls: "Walls",
  laboratory: "Lab research",
  clan_castle: "Clan Castle",
};

export function humanizeCategory(value: string) {
  return CATEGORY_LABELS[value] ?? titleCase(value);
}

export function humanizeSubject(value: string) {
  return titleCase(value);
}

export function humanizeSlug(value: string) {
  return titleCase(value);
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
