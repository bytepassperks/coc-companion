import type {
  AccountAnalysis,
  AccountCategory,
  AccountItem,
  CatalogEntity,
  CatalogLevel,
  GameCatalog,
  Player,
  Provenance,
} from "./types";
import unlockRequirements from "../config/unlock-requirements.json";

type UnlockRequirements = {
  troops: Record<string, { townHall: number; building: string }>;
  spells: Record<string, { townHall: number; building: string }>;
  heroes: Record<string, { townHall: number; building: string }>;
};

const unlockMap = unlockRequirements as UnlockRequirements;
const SUPER_TROOP_NAMES = new Set(["Sneaky Goblin", "Ice Hound", "Inferno Dragon", "Rocket Balloon"]);

export function isSuperTroopName(name: string) {
  return name.startsWith("Super ") || SUPER_TROOP_NAMES.has(name);
}

function isTemporary(entity: CatalogEntity) {
  return entity.levels.length > 0 &&
    entity.levels.every((level) =>
      (level.upgrade_cost ?? level.build_cost ?? 0) === 0 &&
      (level.upgrade_time ?? level.build_time ?? 0) === 0,
    );
}

function active(entities: CatalogEntity[]) {
  return entities.filter((entity) => !isTemporary(entity));
}

export function thCap(entity: CatalogEntity, townHall: number, apiMaxLevel?: number) {
  const available = entity.levels.filter((level) =>
    (level.required_townhall ?? 0) <= townHall,
  );
  if (available.length > 0) return Math.max(...available.map((level) => level.level));
  return apiMaxLevel ?? 0;
}

function next(entity: CatalogEntity, current: number, cap: number) {
  if (current >= cap) return null;
  const level = entity.levels.find((item) => item.level === current + 1)
    ?? entity.levels.find((item) => item.level > current && item.level <= cap);
  if (!level) return null;
  return {
    cost: level.upgrade_cost ?? level.build_cost ?? 0,
    resource: entity.resource,
    time: level.upgrade_time ?? level.build_time ?? 0,
    requiredTH: level.required_townhall,
    requiredLab: level.required_lab_level,
  };
}

function category(
  entities: CatalogEntity[],
  payload: Array<{ name: string; level: number; maxLevel?: number }> | undefined,
  townHall: number,
  requirements: Record<string, { townHall: number; building: string }>,
): AccountCategory {
  const byName = new Map((payload ?? []).map((item) => [item.name, item]));
  const items = entities.map((entity): AccountItem => {
    const observed = byName.get(entity.name);
    const level = observed?.level ?? 0;
    const unlockTownHall = requirements[entity.name]?.townHall;
    const cap = unlockTownHall !== undefined && unlockTownHall > townHall
      ? 0
      : thCap(entity, townHall, observed?.maxLevel);
    const hasThLevels = cap > 0 && entity.levels.some((item) => (item.required_townhall ?? 0) <= townHall);
    return {
      name: entity.name,
      level,
      thCapLevel: cap,
      remainingLevels: Math.max(0, cap - level),
      provenance: observed ? "observed" : "calculated",
      apiMaxLevel: observed?.maxLevel,
      ...(hasThLevels || observed?.maxLevel === undefined ? {} : { maxLevelSource: "api" as const }),
      nextUpgrade: observed ? next(entity, level, cap) : null,
    };
  });
  const total = items.reduce((sum, item) => sum + item.thCapLevel, 0);
  const complete = items.reduce((sum, item) => sum + Math.min(item.level, item.thCapLevel), 0);
  return {
    items,
    completion: total ? complete / total : 1,
    provenance: "calculated",
  };
}

function achievementHighlights(player: Player) {
  return (player.achievements ?? [])
    .filter((achievement) => achievement.target > achievement.value)
    .sort((a, b) => (b.value / b.target) - (a.value / a.target))
    .slice(0, 5);
}

export function analyzeAccount(player: Player, catalog: GameCatalog): AccountAnalysis {
  const th = player.townHallLevel;
  const heroes = category(active(catalog.heroes.filter((item) => item.village === "home")), player.heroes, th, unlockMap.heroes);
  const troops = category(
    active(catalog.troops.filter((item) => item.village === "home" && !isSuperTroopName(item.name))),
    player.troops?.filter((item) => item.village !== "builderBase" && !item.superTroopIsActive && !isSuperTroopName(item.name)),
    th,
    unlockMap.troops,
  );
  const spells = category(
    active(catalog.spells.filter((item) => item.village === "home")),
    player.spells,
    th,
    unlockMap.spells,
  );
  const builderBase = category(
    active(catalog.troops.filter((item) => item.village === "builderBase" && !isSuperTroopName(item.name))),
    player.troops?.filter((item) => item.village === "builderBase" && !item.superTroopIsActive && !isSuperTroopName(item.name)),
    player.builderHallLevel ?? 0,
    {},
  );
  const categories = { heroes, troops, spells, builderBase };
  const values = Object.values(categories);
  const total = values.reduce((sum, item) => sum + item.items.reduce((n, row) => n + row.thCapLevel, 0), 0);
  const complete = values.reduce((sum, item) => sum + item.items.reduce((n, row) => n + Math.min(row.level, row.thCapLevel), 0), 0);
  const unlockable: AccountAnalysis["unlockable"] = [];
  for (const [name, entities, level] of [
    ["heroes", active(catalog.heroes.filter((item) => item.village === "home")), th],
    ["troops", active(catalog.troops.filter((item) => item.village === "home" && !isSuperTroopName(item.name))), th],
    ["spells", active(catalog.spells.filter((item) => item.village === "home")), th],
  ] as const) {
    const known = new Set(
      (name === "heroes" ? player.heroes : name === "troops" ? player.troops : player.spells)
        ?.map((item) => item.name),
    );
    for (const entity of entities) {
      const requirement = unlockMap[name]?.[entity.name];
      if (requirement && !known.has(entity.name) && requirement.townHall <= level) {
        unlockable.push({
          name: entity.name,
          category: name,
          building: requirement.building,
          townHall: requirement.townHall,
          provenance: "calculated",
        });
      }
    }
  }
  return {
    townHallLevel: th,
    categories,
    overallCompletion: total ? complete / total : 1,
    unlockable,
    achievements: achievementHighlights(player),
    provenance: "calculated",
  };
}

export function catalogUpgrade(entity: CatalogEntity, level: number): CatalogLevel | undefined {
  return entity.levels.find((item) => item.level === level);
}
