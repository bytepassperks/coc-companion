import { mkdir, writeFile } from "node:fs/promises";

const SOURCE = "https://raw.githubusercontent.com/mathsman5133/coc.py/master/coc/static/static_data.json";
const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`Catalog fetch failed: ${response.status}`);
const source = await response.json();

const level = (entry) => ({
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

const entity = (item) => ({
  name: item.name,
  village: item.village ?? "home",
  ...(item.upgrade_resource ? { resource: item.upgrade_resource } : {}),
  levels: (item.levels ?? []).map(level),
});

const catalog = {
  metadata: {
    source: SOURCE,
    upstream: "coc.guide via coc.py (MIT)",
    accessed: "2026-07-21",
    game_version: "July 2026 (TH18)",
  },
  heroes: source.heroes.map(entity),
  troops: source.troops.map(entity),
  spells: source.spells.map(entity),
  buildings: source.buildings.map(entity),
  traps: source.traps.map(entity),
};

await mkdir(new URL("../config/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../config/game-data.json", import.meta.url),
  `${JSON.stringify(catalog)}\n`,
);
console.log(`Wrote config/game-data.json (${JSON.stringify(catalog).length} bytes)`);
