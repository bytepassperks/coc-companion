import type {
  AccountAnalysis,
  BaseState,
  GameCatalog,
  NextBestAction,
  Player,
} from "./types";

type Upgrade = { cost: number; resource?: string; time: number; requiredTH?: number; requiredLab?: number };
type Candidate = NextBestAction & {
  kind: "upgrade" | "unlock" | "hint";
  rawCost?: number;
  rawTime?: number;
  strategic?: number;
  availability?: number;
  gate?: number;
  confidenceFactor?: number;
};

export interface TimerContext {
  buildersBusy: boolean;
}

const goalOf = (base?: BaseState) => base?.goal ?? "balanced";
const resourceKey = (resource?: string) =>
  resource?.toLowerCase().includes("dark") ? "darkElixir" :
  resource?.toLowerCase().includes("elixir") ? "elixir" : "gold";

function median(values: number[], fallback = 1) {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return fallback;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function getNextBestActions(
  player: Player,
  catalog: GameCatalog,
  analysis: AccountAnalysis,
  base?: BaseState,
  timerContext?: TimerContext,
): NextBestAction[] {
  const goal = goalOf(base);
  const candidates: Candidate[] = [];
  const addUpgrade = (
    category: string,
    subject: string,
    item: { level: number; nextUpgrade: NonNullable<ReturnType<typeof upgrade>> },
    builder: boolean,
  ) => {
    const cost = item.nextUpgrade.cost;
    const time = item.nextUpgrade.time;
    const notes: string[] = [];
    const resource = item.nextUpgrade.resource;
    const affordable = base?.resources
      ? (base.resources[resourceKey(resource)] ?? 0) >= cost
      : undefined;
    if (affordable === false) notes.push("Not affordable with entered resources.");
    if (builder && base?.buildersFree === 0) notes.push("No free builder.");
    if (timerContext?.buildersBusy && builder) notes.push("All builders are busy according to active timers; prioritize laboratory work while you wait.");
    if (timerContext?.buildersBusy && !builder) notes.push("Active builder timers are full; this laboratory action can progress while builders are occupied.");
    if (!builder && base?.labBusy) notes.push("Laboratory is busy.");
    let strategic = category === "hero upgrade" ? 1.15 : 1;
    if (goal === "war" && category === "hero upgrade" && player.warPreference === "in") strategic *= 0.6;
    if (goal === "farm" && time <= 86400) strategic *= 1.25;
    if (goal === "farm" && cost <= 100_000) strategic *= 1.5;
    const selectedArmy = base?.sameArmy ? base.warArmy : (goal === "war" ? base?.warArmy : base?.homeArmy);
    if (!builder && selectedArmy?.includes(subject)) {
      strategic *= 1.5;
      notes.push(`In your ${goal === "war" ? "war" : "home"} army.`);
    }
    candidates.push({
      action: `Upgrade ${subject}`,
      category,
      subject,
      targetLevel: item.level + 1,
      cost,
      resource,
      timeSeconds: time,
      score: 0,
      confidence: "community_consensus",
      provenance: "calculated",
      notes,
      affordable,
      kind: "upgrade",
      rawCost: cost,
      rawTime: time,
      strategic,
      availability: affordable === false ? 0.65 : 1,
      gate: builder && (base?.buildersFree === 0 || timerContext?.buildersBusy) ? 0.3 : !builder && base?.labBusy ? 0.3 : 1,
      confidenceFactor: 0.9,
    });
  };

  for (const item of analysis.categories.heroes.items) {
    if (item.nextUpgrade) addUpgrade("hero upgrade", item.name, item as never, true);
  }
  for (const group of [analysis.categories.troops, analysis.categories.spells]) {
    for (const item of group.items) {
      if (!item.nextUpgrade) continue;
      if (item.name.startsWith("Super ") || (item.nextUpgrade.cost <= 0 && item.nextUpgrade.time <= 0)) continue;
      addUpgrade("lab upgrade", item.name, item as never, false);
    }
  }
  const unlockCandidates = [...analysis.unlockable]
    .sort((a, b) => (b.townHall ?? 0) - (a.townHall ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 5);
  for (const item of unlockCandidates) {
    candidates.push({
      action: `Unlock ${item.name} (requires ${item.building ?? "the appropriate building"})`,
      category: `unlock ${item.category}`,
      subject: item.name,
      score: 0,
      confidence: "community_consensus",
      provenance: "calculated",
      notes: ["Available at this Town Hall; verify the prerequisite building in your manual base state."],
      kind: "unlock",
    });
  }
  if (base?.buildingLevels) {
    for (const entity of catalog.buildings) {
      const levels = base.buildingLevels[entity.name];
      if (!levels?.length) continue;
      const current = Math.max(...levels);
      const cap = entity.levels
        .filter((item) => (item.required_townhall ?? 0) <= player.townHallLevel)
        .map((item) => item.level)
        .at(-1) ?? current;
      const target = entity.levels.find((item) => item.level === current + 1 && item.level <= cap);
      if (!target) continue;
      addUpgrade("building upgrade", entity.name, {
        level: current,
        nextUpgrade: {
          cost: target.build_cost ?? target.upgrade_cost ?? 0,
          resource: entity.resource,
          time: target.build_time ?? target.upgrade_time ?? 0,
          requiredTH: target.required_townhall,
        },
      }, true);
    }
  } else {
    candidates.push({
      action: "Enter manual base data",
      category: "base data",
      subject: "Buildings and builders",
      score: 0.05,
      confidence: "official",
      provenance: "unavailable",
      notes: ["Official player API does not expose building levels, resources, or builder availability."],
      kind: "hint",
    });
  }

  const upgrades = candidates.filter((candidate) => candidate.kind === "upgrade");
  const medianCost = median(upgrades.map((candidate) => candidate.rawCost ?? 0));
  const medianTime = median(upgrades.map((candidate) => candidate.rawTime ?? 0));
  for (const candidate of upgrades) {
    const normCost = (candidate.rawCost ?? 0) / medianCost;
    const normTime = (candidate.rawTime ?? 0) / medianTime;
    candidate.score = (candidate.strategic ?? 1) *
      (candidate.confidenceFactor ?? 1) *
      (candidate.availability ?? 1) *
      (candidate.gate ?? 1) /
      ((normCost + 0.15) * (normTime + 0.15));
    if (candidate.affordable === true) candidate.score *= 1.25;
  }
  for (const candidate of candidates.filter((item) => item.kind === "unlock")) {
    candidate.score = 0.75 / (1.15 * 1.15);
  }

  const rankedUpgrades = upgrades.sort((a, b) => b.score - a.score);
  const unlocks = candidates.filter((candidate) => candidate.kind === "unlock");
  const hints = candidates.filter((candidate) => candidate.kind === "hint");
  return [...rankedUpgrades.slice(0, 3), ...unlocks, ...rankedUpgrades.slice(3), ...hints]
    .slice(0, 20)
    .map(({ kind: _kind, rawCost: _cost, rawTime: _time, strategic: _strategic, availability: _availability, gate: _gate, confidenceFactor: _confidence, ...action }) => action);
}

function upgrade(item: { nextUpgrade: Upgrade | null }) {
  return item.nextUpgrade;
}
