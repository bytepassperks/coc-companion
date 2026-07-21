export interface ApiList<T> {
  items: T[];
  paging?: { cursors?: { after?: string } };
}

export interface Hero {
  name: string;
  level: number;
  maxLevel?: number;
  equipment?: Array<{ name: string; level: number; maxLevel?: number }>;
}

export interface Troop {
  name: string;
  level: number;
  maxLevel?: number;
  village?: "home" | "builderBase";
}

export interface Spell {
  name: string;
  level: number;
  maxLevel?: number;
}

export interface Player {
  tag: string;
  name: string;
  townHallLevel: number;
  expLevel?: number;
  trophies?: number;
  bestTrophies?: number;
  builderBaseTrophies?: number;
  clan?: { tag: string; name: string };
  heroes?: Hero[];
  troops?: Troop[];
  spells?: Spell[];
  achievements?: unknown[];
  labels?: unknown[];
}

export interface ClanMember {
  tag: string;
  name: string;
  role?: string;
  expLevel?: number;
  trophies?: number;
  clanRank?: number;
  previousClanRank?: number;
}

export interface Clan {
  tag: string;
  name: string;
  description?: string;
  clanLevel?: number;
  clanPoints?: number;
  members?: number;
  memberList?: ClanMember[];
  warFrequency?: string;
  warWinStreak?: number;
  warWins?: number;
  warLosses?: number;
  isWarLogPublic?: boolean;
  capitalLeague?: { id: number; name: string };
  capitalPoints?: number;
}

export interface WarClan {
  tag: string;
  name: string;
  clanLevel?: number;
  attacks?: number;
  stars?: number;
  destructionPercentage?: number;
  members?: Array<ClanMember & { attacks?: Array<{ stars: number; destructionPercentage: number }> }>;
}

export interface CurrentWar {
  state: "notInWar" | "preparation" | "inWar" | "warEnded" | string;
  teamSize?: number;
  preparationStartTime?: string;
  startTime?: string;
  endTime?: string;
  clan?: WarClan;
  opponent?: WarClan;
}

export interface WarLogEntry {
  result?: "win" | "lose" | "tie";
  endTime?: string;
  teamSize?: number;
  clan?: WarClan;
  opponent?: WarClan;
}

export interface RaidSeason {
  state?: "ongoing" | "ended" | string;
  startTime?: string;
  endTime?: string;
  attackLog?: unknown[];
  defenseLog?: unknown[];
  members?: unknown[];
  capitalTotalLoot?: number;
  raidsCompleted?: number;
}

export interface GoldPassSeason {
  startTime?: string;
  endTime?: string;
  seasonId?: string;
  challenges?: unknown[];
}

export interface ApiErrorBody {
  reason?: string;
  message?: string;
  detail?: string;
}

export interface Snapshot {
  fetchedAt: string;
  player: Player;
  clan?: Clan;
  currentWar?: CurrentWar;
  raidSeasons?: RaidSeason[];
  goldPassSeason?: GoldPassSeason;
}

export interface NotificationEvent {
  id: string;
  type: "upgrade_completed" | "war_window_open" | "capital_raid_active";
  createdAt: string;
  message: string;
  data?: Record<string, string | number>;
}

export interface Recommendation {
  category: string;
  subject: string;
  reason: string;
  priority: number;
  confidence: "official" | "community_consensus" | "unverified";
  lastUpdated: string;
}
