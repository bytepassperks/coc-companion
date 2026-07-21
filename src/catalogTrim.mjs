export const CATALOG_SOURCE = "https://raw.githubusercontent.com/mathsman5133/coc.py/master/coc/static/static_data.json";

const trimLevel = (entry) => ({
  level: entry.level,
  ...(entry.upgrade_cost !== undefined ? { upgrade_cost: entry.upgrade_cost } : {}),
  ...(entry.build_cost !== undefined ? { build_cost: entry.build_cost } : {}),
  ...(entry.upgrade_time !== undefined ? { upgrade_time: entry.upgrade_time } : {}),
  ...(entry.build_time !== undefined ? { build_time: entry.build_time } : {}),
  ...(entry.required_townhall !== undefined ? { required_townhall: entry.required_townhall } : {}),
  ...(entry.required_lab_level !== undefined ? { required_lab_level: entry.required_lab_level } : {}),
  ...(entry.required_hero_tavern_level !== undefined
    ? { required_hero_tavern_level: entry.required_hero_tavern_level }
    : {}),
});

const trimEntity = (item) => ({
  name: item.name,
  village: item.village ?? "home",
  ...(item.upgrade_resource ? { resource: item.upgrade_resource } : {}),
  levels: (item.levels ?? []).map(trimLevel),
});

export function trimCatalog(source, accessed = new Date().toISOString()) {
  return {
    metadata: {
      source: CATALOG_SOURCE,
      upstream: "coc.guide via coc.py (MIT)",
      accessed,
      game_version: "Latest available coc.py data",
    },
    heroes: (source.heroes ?? []).map(trimEntity),
    troops: (source.troops ?? []).map(trimEntity),
    spells: (source.spells ?? []).map(trimEntity),
    buildings: (source.buildings ?? []).map(trimEntity),
    traps: (source.traps ?? []).map(trimEntity),
  };
}
