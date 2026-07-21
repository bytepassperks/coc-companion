import { thCap } from "./analyzer";
import type { AccountAnalysis, GameCatalog, Player } from "./types";

export interface RushCategory {
  name: string;
  completion: number;
  rushed: boolean;
  weight: number;
  provenance: string;
}

export interface RushReport {
  score: number;
  categories: RushCategory[];
  verdict: "ready" | "almost" | "not_ready";
  reasons: string[];
  unavailableNote: string;
}

function completion(values: number[], denominator: number) {
  return denominator ? Math.min(1, values.reduce((sum, value) => sum + value, 0) / denominator) : 1;
}

function priorCategory(
  names: string[],
  entities: GameCatalog["heroes"],
  levels: Array<{ name: string; level: number }>,
  townHall: number,
) {
  const observed = new Map(levels.map((item) => [item.name, item.level]));
  const relevant = entities.filter((entity) => names.includes(entity.name));
  const caps = relevant.map((entity) => ({ entity, cap: thCap(entity, Math.max(1, townHall - 1), 0) })).filter((item) => item.cap > 0);
  return {
    numerator: caps.reduce((sum, item) => sum + Math.min(observed.get(item.entity.name) ?? 0, item.cap), 0),
    denominator: caps.reduce((sum, item) => sum + item.cap, 0),
    hasShortfall: caps.some((item) => (observed.get(item.entity.name) ?? 0) < item.cap),
  };
}

export function calculateRushScore(player: Player, analysis: AccountAnalysis, catalog: GameCatalog): RushReport {
  const th = player.townHallLevel;
  const troops = priorCategory(analysis.categories.troops.items.map((item) => item.name), catalog.troops, player.troops?.filter((item) => item.village !== "builderBase") ?? [], th);
  const spells = priorCategory(analysis.categories.spells.items.map((item) => item.name), catalog.spells, player.spells ?? [], th);
  const heroes = priorCategory(analysis.categories.heroes.items.map((item) => item.name), catalog.heroes, player.heroes ?? [], th);
  const equipment = player.heroEquipment?.length
    ? { completion: completion(player.heroEquipment.map((item) => item.level), player.heroEquipment.reduce((sum, item) => sum + (item.maxLevel ?? item.level), 0)), hasShortfall: player.heroEquipment.some((item) => item.level < (item.maxLevel ?? item.level)) }
    : { completion: 1, hasShortfall: false };
  const categories: RushCategory[] = [
    { name: "Offense troops", completion: completion([troops.numerator], troops.denominator), rushed: troops.hasShortfall, weight: 0.35, provenance: "previous Town Hall catalog caps" },
    { name: "Lab research", completion: completion([spells.numerator], spells.denominator), rushed: spells.hasShortfall, weight: 0.2, provenance: "previous Town Hall catalog caps" },
    { name: "Heroes", completion: completion([heroes.numerator], heroes.denominator), rushed: heroes.hasShortfall, weight: 0.3, provenance: "previous Town Hall catalog caps" },
    { name: "Equipment", completion: equipment.completion, rushed: equipment.hasShortfall, weight: 0.15, provenance: "observed API maximums; no TH cap exposed" },
  ];
  const score = Math.round(categories.reduce((sum, category) => sum + category.completion * category.weight, 0) * 100);
  const rushed = categories.filter((category) => category.rushed);
  const verdict = score >= 90 && rushed.length === 0 ? "ready" : score >= 75 ? "almost" : "not_ready";
  const reasons = rushed.map((category) => `${category.name} is below the previous Town Hall's maximum.`);
  if (!reasons.length) reasons.push("Offense, research, heroes, and observed equipment are caught up to the available comparison.");
  return {
    score,
    categories,
    verdict,
    reasons,
    unavailableNote: "Building and defense levels are unavailable from the public player API, so this score cannot certify a fully unrushed base.",
  };
}
