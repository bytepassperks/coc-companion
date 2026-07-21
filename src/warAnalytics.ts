import type { CurrentWar, WarClan } from "./types";

export interface WarMemberAnalytics {
  tag: string;
  name: string;
  townHall?: number;
  mapPosition?: number;
  attacksUsed: number;
  attacksRemaining: number;
  bestAttackStars: number;
}

export interface WarAnalytics {
  state: string;
  message?: string;
  teamSize?: number;
  startTime?: string;
  endTime?: string;
  sides: Array<{
    tag: string;
    name: string;
    stars: number;
    destructionPercentage: number;
  }>;
  attacksPerMember: number;
  members: WarMemberAnalytics[];
  unattacked: WarMemberAnalytics[];
  provenance: "calculated";
}

function sideSummary(side: WarClan | undefined): WarAnalytics["sides"][number] | undefined {
  return side ? {
    tag: side.tag,
    name: side.name,
    stars: side.stars ?? 0,
    destructionPercentage: side.destructionPercentage ?? 0,
  } : undefined;
}

export function analyzeWar(war: CurrentWar | undefined, clanTag?: string): WarAnalytics {
  if (!war || war.state === "notInWar") {
    return {
      state: "notInWar",
      message: "This clan is not currently in a war.",
      sides: [],
      attacksPerMember: 0,
      members: [],
      unattacked: [],
      provenance: "calculated",
    };
  }
  const own = clanTag && war.clan?.tag === clanTag ? war.clan : war.clan;
  const attacksPerMember = war.teamSize && war.teamSize > 0 ? 2 : 0;
  const members = (own?.members ?? []).map((member) => {
    const attacks = member.attacks ?? [];
    const row = {
      tag: member.tag,
      name: member.name,
      townHall: member.townHallLevel,
      mapPosition: member.mapPosition,
      attacksUsed: attacks.length,
      attacksRemaining: Math.max(0, attacksPerMember - attacks.length),
      bestAttackStars: attacks.reduce((best, attack) => Math.max(best, attack.stars), 0),
    };
    return row;
  });
  return {
    state: war.state,
    teamSize: war.teamSize,
    startTime: war.startTime ?? war.preparationStartTime,
    endTime: war.endTime,
    sides: [sideSummary(war.clan), sideSummary(war.opponent)].filter((side): side is WarAnalytics["sides"][number] => side !== undefined),
    attacksPerMember,
    members,
    unattacked: members.filter((member) => member.attacksUsed === 0),
    provenance: "calculated",
  };
}
