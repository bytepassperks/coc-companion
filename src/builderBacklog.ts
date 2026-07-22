import type { BaseState, GameCatalog } from "./types";

export type BuilderBacklogInput = { name: string; count: number; cost: number; resource?: string };

export function inferBuilderBacklog(entries: BuilderBacklogInput[], catalog: GameCatalog): NonNullable<BaseState["builderBacklog"]> {
  return entries.map((entry) => {
    const exactMatches = catalog.buildings
      .filter((entity) => entity.village === "home" && entity.name.toLowerCase() === entry.name.toLowerCase())
      .flatMap((entity) => entity.levels
        .filter((level) => (level.build_cost ?? level.upgrade_cost) === entry.cost)
        .map((level) => ({ level: level.level, resource: entity.resource })));
    const discounts = [0.9, 0.85, 0.8];
    const discountedMatches = catalog.buildings
      .filter((entity) => entity.village === "home" && entity.name.toLowerCase() === entry.name.toLowerCase())
      .flatMap((entity) => entity.levels.flatMap((level) => {
        const baseCost = level.build_cost ?? level.upgrade_cost;
        if (baseCost === undefined || baseCost <= 0) return [];
        return discounts
          .filter((discount) => Math.round(baseCost * discount / 10000) * 10000 === entry.cost)
          .map((discount) => ({ level: level.level, discount, resource: entity.resource }));
      }));
    const tolerantMatches = discountedMatches.length ? discountedMatches : catalog.buildings
      .filter((entity) => entity.village === "home" && entity.name.toLowerCase() === entry.name.toLowerCase())
      .flatMap((entity) => entity.levels.flatMap((level) => {
        const baseCost = level.build_cost ?? level.upgrade_cost;
        if (baseCost === undefined || baseCost <= 0) return [];
        return discounts
          .filter((discount) => Math.abs(baseCost * discount - entry.cost) <= Math.max(baseCost * discount * 0.01, 10000))
          .map((discount) => ({ level: level.level, discount, resource: entity.resource }));
      }));
    const uniqueLevels = [...new Set(exactMatches.map((match) => match.level))];
    const uniqueDiscounted = [...new Set(tolerantMatches.map((match) => `${match.level}:${match.discount}`))];
    const resources = [...new Set((exactMatches.length ? exactMatches : tolerantMatches).map((match) => match.resource).filter(Boolean))];
    const exact = uniqueLevels.length === 1;
    const discounted = !exactMatches.length && uniqueDiscounted.length === 1
      ? tolerantMatches[0] : undefined;
    return {
      ...entry,
      resource: resources.length === 1 ? resources[0] : entry.resource,
      targetLevel: exact ? uniqueLevels[0] : discounted?.level,
      provenance: exact
        ? "inferred from cost" as const
        : discounted ? "inferred from discounted cost (Gold Pass boost)" as const : undefined,
    };
  });
}
