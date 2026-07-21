export interface ApiList<T> {
  items: T[];
  paging?: { cursors?: { after?: string } };
}

export interface Hero {
  name: string;
  level: number;
  maxLevel?: number;
  village?: "home" | "builderBase";
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
  village?: "home" | "builderBase";
}

export interface Achievement {
  name: string;
  stars?: number;
  value: number;
  target: number;
  info?: string;
  completionInfo?: string | null;
  village?: string;
}

export interface Player {
  tag: string;
  name: string;
  townHallLevel: number;
  builderHallLevel?: number;
  expLevel?: number;
  trophies?: number;
  bestTrophies?: number;
  builderBaseTrophies?: number;
  clan?: { tag: string; name: string };
  warPreference?: "in" | "out";
  heroes?: Hero[];
  troops?: Troop[];
  spells?: Spell[];
  achievements?: Achievement[];
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
  type: "upgrade_completed" | "war_window_open" | "capital_raid_active" | "th_upgraded";
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

export type Provenance = "observed" | "calculated" | "estimated" | "unavailable";

export interface CatalogLevel {
  level: number;
  upgrade_cost?: number;
  build_cost?: number;
  upgrade_time?: number;
  build_time?: number;
  required_townhall?: number;
  required_lab_level?: number;
  required_hero_tavern_level?: number;
}

export interface CatalogEntity {
  name: string;
  village: "home" | "builderBase";
  resource?: string;
  levels: CatalogLevel[];
}

export interface GameCatalog {
  metadata: {
    source: string;
    upstream: string;
    accessed: string;
    game_version: string;
  };
  heroes: CatalogEntity[];
  troops: CatalogEntity[];
  spells: CatalogEntity[];
  buildings: CatalogEntity[];
  traps: CatalogEntity[];
}

export interface UnlockRequirement {
  townHall: number;
  building: string;
}

export interface AccountItem {
  name: string;
  level: number;
  thCapLevel: number;
  remainingLevels: number;
  provenance: Provenance;
  maxLevelSource?: "api";
  nextUpgrade: {
    cost: number;
    resource?: string;
    time: number;
    requiredTH?: number;
    requiredLab?: number;
  } | null;
}

export interface AccountCategory {
  items: AccountItem[];
  completion: number;
  provenance: Provenance;
}

export interface AccountAnalysis {
  townHallLevel: number;
  categories: {
    heroes: AccountCategory;
    troops: AccountCategory;
    spells: AccountCategory;
    builderBase: AccountCategory;
  };
  overallCompletion: number;
  unlockable: Array<{ name: string; category: string; building?: string; townHall?: number; provenance: Provenance }>;
  achievements: Achievement[];
  provenance: Provenance;
}

export interface BaseState {
  buildersTotal?: number;
  buildersFree?: number;
  labBusy?: boolean;
  resources?: {
    gold?: number;
    elixir?: number;
    darkElixir?: number;
  };
  goal?: "war" | "farm" | "trophy" | "balanced";
  buildingLevels?: Record<string, number[]>;
  updatedAt: string;
}

export interface NextBestAction {
  action: string;
  category: string;
  subject: string;
  targetLevel?: number;
  cost?: number;
  resource?: string;
  timeSeconds?: number;
  score: number;
  confidence: "official" | "community_consensus" | "unverified";
  provenance: Provenance;
  notes: string[];
  affordable?: boolean;
}
