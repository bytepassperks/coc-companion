import type { RaidSeason } from "./types";

export interface CapitalAnalytics {
  state?: string;
  startTime?: string;
  endTime?: string;
  offensiveLoot: number;
  defensiveLoot: number;
  totalAttacks: number;
  raidsCompleted: number;
  districtsDestroyed: number;
  averageLootPerAttack: number;
  topRaiders: Array<{ tag?: string; name?: string; loot: number; attacks: number }>;
  provenance: "calculated";
}

export function analyzeCapital(season: RaidSeason | undefined): CapitalAnalytics {
  const members = season?.members ?? [];
  const topRaiders = members.map((member) => ({
    tag: member.tag,
    name: member.name,
    loot: member.capitalResourcesLooted ?? member.capitalGoldLooted ?? 0,
    attacks: member.attackCount ?? member.attacks ?? 0,
  })).sort((a, b) => b.loot - a.loot || (a.name ?? "").localeCompare(b.name ?? "")).slice(0, 5);
  const totalAttacks = season?.totalAttacks ?? members.reduce((sum, member) => sum + (member.attackCount ?? member.attacks ?? 0), 0);
  const offensiveLoot = season?.capitalTotalLoot ?? topRaiders.reduce((sum, member) => sum + member.loot, 0);
  return {
    state: season?.state,
    startTime: season?.startTime,
    endTime: season?.endTime,
    offensiveLoot,
    defensiveLoot: season?.defensiveReward ?? 0,
    totalAttacks,
    raidsCompleted: season?.raidsCompleted ?? members.reduce((sum, member) => sum + (member.raidsCompleted ?? 0), 0),
    districtsDestroyed: season?.enemyDistrictsDestroyed ?? 0,
    averageLootPerAttack: totalAttacks > 0 ? offensiveLoot / totalAttacks : 0,
    topRaiders,
    provenance: "calculated",
  };
}
