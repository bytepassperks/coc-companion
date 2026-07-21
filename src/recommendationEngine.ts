import bundledCatalog from "../config/game-data.json";
import { analyzeAccount } from "./analyzer";
import type { GameCatalog, Player, Recommendation } from "./types";

export interface UpgradePriorityEntry {
  category: string;
  order: number;
  subject?: string;
  reason: string;
  confidence: Recommendation["confidence"];
}

export interface UpgradeConfig {
  last_updated: string;
  priorities: Record<string, UpgradePriorityEntry[]>;
  meta_notes: Record<string, string>;
  army_comp_suggestions: Record<string, string[]>;
}

export function getRecommendations(player: Player, config: UpgradeConfig, catalog = bundledCatalog as unknown as GameCatalog): Recommendation[] {
  const entries = config.priorities[`TH${player.townHallLevel}`] ?? config.priorities.default ?? [];
  const recommendations: Recommendation[] = [];
  const heroes = player.heroes ?? [];
  const troops = player.troops ?? [];
  const analysis = analyzeAccount(player, catalog);
  const heroCaps = new Map(analysis.categories.heroes.items.map((item) => [item.name, item]));
  const troopCaps = new Map(analysis.categories.troops.items.map((item) => [item.name, item]));

  for (const entry of [...entries].sort((a, b) => a.order - b.order)) {
    if (entry.category === "heroes_equipment") {
      for (const hero of heroes.filter((candidate) => candidate.maxLevel !== undefined && candidate.level < (heroCaps.get(candidate.name)?.thCapLevel || candidate.maxLevel))) {
        const cap = heroCaps.get(hero.name)?.thCapLevel;
        const target = cap || hero.maxLevel!;
        const label = cap ? `TH${player.townHallLevel} cap` : "global max";
        recommendations.push({
          category: entry.category,
          subject: hero.name,
          reason: `${entry.reason} ${hero.name} is level ${hero.level}/${target} (${label}).`,
          priority: entry.order,
          confidence: entry.confidence,
          lastUpdated: config.last_updated,
        });
      }
    } else if (entry.category === "laboratory") {
      const troop = troops.find((candidate) => candidate.maxLevel !== undefined && candidate.level < (troopCaps.get(candidate.name)?.thCapLevel || candidate.maxLevel));
      if (troop) {
        const cap = troopCaps.get(troop.name)?.thCapLevel;
        const target = cap || troop.maxLevel!;
        recommendations.push({
          category: entry.category,
          subject: troop.name,
          reason: `${entry.reason} ${troop.name} is level ${troop.level}/${target} (${cap ? `TH${player.townHallLevel} cap` : "global max"}).`,
          priority: entry.order,
          confidence: entry.confidence,
          lastUpdated: config.last_updated,
        });
      }
    } else {
      recommendations.push({
        category: entry.category,
        subject: entry.subject ?? entry.category.replaceAll("_", " "),
        reason: entry.reason,
        priority: entry.order,
        confidence: entry.confidence,
        lastUpdated: config.last_updated,
      });
    }
  }
  return recommendations.sort((a, b) => a.priority - b.priority);
}
