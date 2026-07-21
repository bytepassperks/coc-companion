import meta from "../config/equipment-meta.json";
import type { Player } from "./types";

export interface EquipmentAdvice {
  hero: string;
  recommended: string[];
  current: Array<{ name: string; level: number; maxLevel?: number }>;
  nextBreakpoint?: number;
  oreCost?: { shiny: number; glowy: number; starry: number };
  affordable?: boolean;
  priority: string;
  lineupStatus?: "selected" | "not_in_lineup";
  provenance: string;
}

export interface PetAdvice {
  name: string;
  level: number;
  maxLevel: number;
  recommendedFor?: string;
  priority: string;
  provenance: string;
}

export interface EquipmentPlan {
  equipment: EquipmentAdvice[];
  pets: PetAdvice[];
  unknownEquipment: string[];
  ore?: { shiny?: number; glowy?: number; starry?: number };
}

const config = meta as {
  version: number;
  dated: string;
  sourceNote: string;
  heroes: Record<string, Record<string, string[]>>;
  breakpoints: number[];
  equipmentBreakpoints: Record<string, number[]>;
  oreCosts: Record<string, Record<string, { shiny: number; glowy: number; starry: number }>>;
  defaultOreCosts: Record<string, { shiny: number; glowy: number; starry: number }>;
  petPairings: Record<string, Record<string, string[]>>;
  petUpgradeTimeHours: Record<string, number>;
  petMaxLevels: Record<string, number>;
};

export function adviseEquipment(player: Player, goal = "balanced", ore?: { shiny?: number; glowy?: number; starry?: number }, lineup: string[] = []): EquipmentPlan {
  const equipment = player.heroEquipment?.length ? player.heroEquipment : player.heroes?.flatMap((hero) => hero.equipment ?? []) ?? [];
  const byName = new Map(equipment.map((item) => [item.name, item]));
  const knownEquipment = new Set(Object.values(config.heroes).flatMap((goals) => Object.values(goals).flat()));
  const equipmentAdvice = (player.heroes ?? []).flatMap((hero) => {
      const choices = config.heroes[hero.name]?.[goal] ?? config.heroes[hero.name]?.balanced;
      if (!choices) return [];
      const current = choices.map((name) => byName.get(name)).filter(Boolean) as EquipmentAdvice["current"];
      const nextLevel = current.map((item) => (config.equipmentBreakpoints[item.name] ?? config.breakpoints).find((breakpoint) => breakpoint > item.level)).filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0];
      const sorted = current.sort((a, b) => a.level - b.level);
      const costFor = (item: EquipmentAdvice["current"][number]) => config.oreCosts[item.name]?.[String(item.level + 1)] ?? config.defaultOreCosts.common;
      const canAfford = (item: EquipmentAdvice["current"][number]) => {
        const cost = costFor(item);
        return Boolean(ore && cost && (ore.shiny ?? 0) >= cost.shiny && (ore.glowy ?? 0) >= cost.glowy && (ore.starry ?? 0) >= cost.starry);
      };
      const target = ore ? sorted.find(canAfford) ?? sorted[0] : sorted[0];
      const oreCost = target ? costFor(target) : undefined;
      const affordable = ore && oreCost
        ? canAfford(target)
        : undefined;
      const nextBreakpoint = target ? (config.equipmentBreakpoints[target.name] ?? config.breakpoints).find((breakpoint) => breakpoint > target.level) : undefined;
      const levelsToBreakpoint = target && nextBreakpoint ? Array.from({ length: nextBreakpoint - target.level }, (_, index) => target.level + index + 1) : [];
      const breakpointCost = target && levelsToBreakpoint.length
        ? levelsToBreakpoint.reduce((sum, level) => {
          const item = config.oreCosts[target.name]?.[String(level)] ?? config.defaultOreCosts.common;
          return { shiny: sum.shiny + item.shiny, glowy: sum.glowy + item.glowy, starry: sum.starry + item.starry };
        }, { shiny: 0, glowy: 0, starry: 0 })
        : undefined;
      const breakpointAffordable = ore && breakpointCost
        ? (ore.shiny ?? 0) >= breakpointCost.shiny && (ore.glowy ?? 0) >= breakpointCost.glowy && (ore.starry ?? 0) >= breakpointCost.starry
        : undefined;
      return [{
        hero: hero.name,
        recommended: choices,
        current,
        nextBreakpoint,
        oreCost,
        affordable,
        lineupStatus: (lineup.length && !lineup.includes(hero.name) ? "not_in_lineup" : "selected") as EquipmentAdvice["lineupStatus"],
        priority: target
          ? `Upgrade ${target.name} ${target.level} → ${nextBreakpoint ?? target.level + 1}${breakpointCost ? ` to reach the next power jump (${levelsToBreakpoint.length} levels, ${breakpointCost.shiny} Shiny / ${breakpointCost.glowy} Glowy / ${breakpointCost.starry} Starry total) — ${breakpointAffordable === undefined ? "ore balance not entered" : breakpointAffordable ? "affordable now" : "not affordable yet"}.` : ` first — strongest ${goal} value per ore among the recommended pair.`}`
          : `Prioritize ${choices[0]} when its level is confirmed in the API payload.`,
        provenance: `equipment-meta v${config.version}, dated ${config.dated}; ${config.sourceNote}`,
      }];
    });
  equipmentAdvice.sort((a, b) => (a.lineupStatus === "selected" ? 0 : 1) - (b.lineupStatus === "selected" ? 0 : 1));
  const knownPets = new Set(Object.keys(config.petMaxLevels));
  const petsPayload = player.pets?.length
    ? player.pets
    : (player.troops ?? []).filter((troop) => troop.village !== "builderBase" && knownPets.has(troop.name)).map((troop) => ({ name: troop.name, level: troop.level, maxLevel: troop.maxLevel }));
  const pets = petsPayload.length
    ? petsPayload.map((pet) => {
      const pair = Object.entries(config.petPairings).find(([, goals]) => (lineup.length ? lineup : Object.keys(config.petPairings)).some((hero) => goals[goal]?.includes(pet.name)));
      const maxLevel = pet.maxLevel ?? config.petMaxLevels[pet.name] ?? pet.level;
      const hero = pair?.[0];
      return {
        name: pet.name,
        level: pet.level,
        maxLevel,
        recommendedFor: hero,
        priority: hero ? `${pet.name} pairs with ${hero}; next upgrade should be scheduled by its roughly ${config.petUpgradeTimeHours[pet.name] ?? 48}h laboratory time.` : `${pet.name} is not in the curated pairing list; treat as a lower-confidence option.`,
        provenance: `equipment-meta v${config.version}, dated ${config.dated}; ${config.sourceNote}`,
      };
    })
    : [];
  return { equipment: equipmentAdvice, pets, unknownEquipment: equipment.map((item) => item.name).filter((name) => !knownEquipment.has(name)), ore };
}
