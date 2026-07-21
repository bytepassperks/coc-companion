import type { Player, Recommendation } from "./types";

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

export function getRecommendations(player: Player, config: UpgradeConfig): Recommendation[] {
  const entries = config.priorities[`TH${player.townHallLevel}`] ?? [];
  const recommendations: Recommendation[] = [];
  const heroes = player.heroes ?? [];
  const troops = player.troops ?? [];

  for (const entry of [...entries].sort((a, b) => a.order - b.order)) {
    if (entry.category === "heroes_equipment") {
      for (const hero of heroes.filter((candidate) => candidate.maxLevel !== undefined && candidate.level < candidate.maxLevel)) {
        recommendations.push({
          category: entry.category,
          subject: hero.name,
          reason: `${entry.reason} ${hero.name} is level ${hero.level}/${hero.maxLevel}.`,
          priority: entry.order,
          confidence: entry.confidence,
          lastUpdated: config.last_updated,
        });
      }
    } else if (entry.category === "laboratory") {
      const troop = troops.find((candidate) => candidate.maxLevel !== undefined && candidate.level < candidate.maxLevel);
      if (troop) {
        recommendations.push({
          category: entry.category,
          subject: troop.name,
          reason: `${entry.reason} ${troop.name} is level ${troop.level}/${troop.maxLevel}.`,
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
