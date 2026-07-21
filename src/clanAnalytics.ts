import type { Clan, ClanMember } from "./types";

export interface ClanMemberAnalytics {
  tag: string;
  name: string;
  role?: string;
  townHall?: number;
  trophies?: number;
  donations: number;
  donationsReceived: number;
  donationRatio: number | null;
  provenance: "observed" | "calculated";
}

export interface ClanAnalytics {
  name: string;
  tag: string;
  level?: number;
  warWinstreak?: number;
  warWins?: number;
  warLosses?: number;
  capitalHall?: string | number;
  members: ClanMemberAnalytics[];
  topDonors: ClanMemberAnalytics[];
  inactiveSignalNote: string;
  provenance: "calculated";
}

export function analyzeClan(clan: Clan, members: ClanMember[] = []): ClanAnalytics {
  const rows = members.map((member) => {
    const donations = member.donations ?? 0;
    const donationsReceived = member.donationsReceived ?? 0;
    return {
      tag: member.tag,
      name: member.name,
      role: member.role,
      townHall: member.townHallLevel,
      trophies: member.trophies,
      donations,
      donationsReceived,
      donationRatio: donationsReceived > 0 ? donations / donationsReceived : null,
      provenance: "calculated" as const,
    };
  });
  return {
    name: clan.name,
    tag: clan.tag,
    level: clan.clanLevel,
    warWinstreak: clan.warWinStreak,
    warWins: clan.warWins,
    warLosses: clan.warLosses,
    capitalHall: clan.capitalHallLevel ?? clan.capitalLeague?.name,
    members: rows,
    topDonors: [...rows].sort((a, b) => b.donations - a.donations || a.name.localeCompare(b.name)).slice(0, 5),
    inactiveSignalNote: "Donations are season counters; low donations can signal inactivity but are not proof of inactivity.",
    provenance: "calculated",
  };
}
