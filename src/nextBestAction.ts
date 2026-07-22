import type {
  AccountAnalysis,
  BaseState,
  GameCatalog,
  NextBestAction,
  Player,
} from "./types";
import roleConfig from "../config/action-roles.json";

type Upgrade = { cost: number; resource?: string; time: number; requiredTH?: number; requiredLab?: number };
type Candidate = NextBestAction & {
  kind: "upgrade" | "unlock" | "hint";
  rawCost?: number;
  rawTime?: number;
  strategic?: number;
  availability?: number;
  gate?: number;
  confidenceFactor?: number;
  prioritySelected?: boolean;
  thCapLevel?: number;
  activeTimer?: boolean;
  magicSuggestion?: string;
};

export interface TimerContext {
  buildersBusy: boolean;
  activeLabels?: string[];
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

function durationLabel(seconds: number) {
  if (!seconds) return "duration unavailable";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  return days ? `${days}d${hours ? ` ${hours}h` : ""}` : `${hours || 1}h`;
}

const roles = roleConfig as { categories: Record<string, string>; units: Record<string, string> };
const magicSuggestions: Record<string, string[]> = {
  "hero upgrade": ["bookOfHeroes", "hammerOfHeroes", "bookOfEverything"],
  "lab upgrade": ["bookOfFighting", "hammerOfFighting", "bookOfSpells", "hammerOfSpells", "bookOfEverything", "researchPotion"],
  "building upgrade": ["bookOfBuilding", "hammerOfBuilding", "bookOfEverything", "builderPotion"],
};
const magicLabels: Record<string, string> = {
  bookOfHeroes: "Book of Heroes", bookOfFighting: "Book of Fighting", bookOfSpells: "Book of Spells",
  bookOfBuilding: "Book of Building", bookOfEverything: "Book of Everything",
  hammerOfHeroes: "Hammer of Heroes", hammerOfFighting: "Hammer of Fighting",
  hammerOfSpells: "Hammer of Spells", hammerOfBuilding: "Hammer of Building",
  researchPotion: "Research Potion", builderPotion: "Builder Potion",
};
const builderImpact: Record<string, number> = {
  "X-Bow": 2.2, "Wizard Tower": 2.1, "Hidden Tesla": 2.1, "Bomb Tower": 2,
  "Town Hall": 1.9, "Town Hall Weapon": 1.9, "Seeking Air Mine": 1.5, "Giant Bomb": 1.5,
  "Air Bomb": 1.4, "Spring Trap": 1.3, "Bomb": 1.3, "Wall": 1.1,
  "Dark Elixir Storage": 1, "Elixir Storage": 1, "Gold Storage": 1,
  "Elixir Collector": .9, "Gold Mine": .9, "Dark Elixir Drill": .9,
  "Builder's Hut": .8,
};
function builderImpactFor(name: string) {
  const exact = builderImpact[name];
  if (exact) return exact;
  if (/wall/i.test(name)) return builderImpact.Wall;
  if (/trap|mine|bomb/i.test(name)) return 1.4;
  if (/storage|collector|drill|mine|hut/i.test(name)) return .9;
  return 1.2;
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
    const normalizedSubject = subject.trim().toLowerCase();
    const armySelected = !builder && Boolean(selectedArmy?.some((unit) => unit.trim().toLowerCase() === normalizedSubject));
    const lineupSelected = category === "hero upgrade" && Boolean(base?.heroLineup?.some((hero) => hero.trim().toLowerCase() === normalizedSubject));
    const activeTimer = Boolean(timerContext?.activeLabels?.some((label) => {
      const normalizedLabel = label.trim().toLowerCase();
      return normalizedLabel && (normalizedSubject.includes(normalizedLabel) || normalizedLabel.includes(normalizedSubject));
    }));
    const ownedMagic = (magicSuggestions[category] ?? []).find((item) => (base?.magicItems?.[item as keyof NonNullable<BaseState["magicItems"]>] ?? 0) > 0);
    const magicSuggestion = ownedMagic ? (() => {
      const label = magicLabels[ownedMagic];
      if (ownedMagic.endsWith("Potion")) return `${label} can accelerate this ${category === "lab upgrade" ? "laboratory" : "builder"} work while it is busy.`;
      return `You own a ${label} — it can instantly finish this ${category === "hero upgrade" ? "hero" : category === "lab upgrade" ? "lab" : "building"} upgrade; consider it for the longest queued upgrade.`;
    })() : undefined;
    if (magicSuggestion) notes.push(magicSuggestion);
    const prioritySelected = (armySelected || lineupSelected) && !activeTimer;
    if (armySelected) {
      strategic *= 1.5;
      notes.push(`In your ${goal === "war" ? "war" : "home"} army.`);
    }
    if (lineupSelected) {
      strategic *= 1.5;
      notes.push("In your hero lineup.");
    }
    if (activeTimer) {
      notes.push("Already in progress (timer).");
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
      why: "",
      affordable,
      kind: "upgrade",
      rawCost: cost,
      rawTime: time,
      strategic,
      gate: builder && (base?.buildersFree === 0 || timerContext?.buildersBusy) ? 0.3 : !builder && base?.labBusy ? 0.3 : 1,
      confidenceFactor: 0.9,
      prioritySelected,
      thCapLevel: (item as { thCapLevel?: number }).thCapLevel,
      activeTimer,
      magicSuggestion,
      availability: activeTimer ? 0.35 : affordable === false ? 0.65 : 1,
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
      why: "This unlock is available at your Town Hall; verify the prerequisite building before committing.",
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
      why: "The public API does not expose enough manual base data to rank this action more precisely.",
      kind: "hint",
    });
  }
  if (base?.wallLevel !== undefined || base?.wallCount !== undefined) {
    const count = base.wallCount ?? 0;
    const level = base.wallLevel ?? 0;
    candidates.push({
      action: "Plan wall upgrades",
      category: "walls",
      subject: "Walls",
      score: 0.8,
      confidence: "community_consensus",
      provenance: "calculated",
      notes: ["Wall level and count are manual inputs; the public API does not expose wall progress."],
      why: `About ${count} walls are recorded at level ${level}; use overflow loot and Star Bonuses to catch them up.`,
      kind: "hint",
    });
  }
  if (base?.clanGamesActive) {
    candidates.push({
      action: "Complete Clan Games challenges",
      category: "clan games",
      subject: "Clan Games",
      score: 0.9,
      confidence: "community_consensus",
      provenance: "calculated",
      notes: ["Clan Games can award useful books, hammers, and potions; rewards are advisory and claimed manually."],
      why: "Clan Games can provide magic-item rewards such as books, hammers, and potions; complete useful challenges manually while active.",
      kind: "hint",
    });
  }
  if (base?.builderBacklog?.length) {
    for (const entry of base.builderBacklog) {
      const busy = Boolean(timerContext?.buildersBusy);
      const target = entry.targetLevel === undefined ? "" : ` to inferred level ${entry.targetLevel}`;
      const count = entry.count > 1 ? ` (${entry.count} queued)` : "";
      const notes = [`Manual builder backlog${count}.`];
      if (busy) notes.push("All builders are busy according to active timers; keep this queued until one frees.");
      candidates.push({
        action: `Upgrade ${entry.name}`,
        category: "builder backlog",
        subject: entry.name,
        targetLevel: entry.targetLevel,
        cost: entry.cost,
        resource: entry.resource,
        timeSeconds: 86400,
        score: 0,
        confidence: "community_consensus",
        provenance: entry.provenance === "inferred from cost" ? "calculated" : "estimated",
        notes,
        why: `${entry.name}${target} costs ${entry.cost.toLocaleString()} ${entry.resource ?? "resource"}; ${busy ? "all builders are busy, so keep it queued." : "this is a builder-ready backlog option."}`,
        kind: "upgrade",
        rawCost: entry.cost,
        rawTime: 86400,
        strategic: builderImpactFor(entry.name),
        gate: busy ? .3 : 1,
        confidenceFactor: entry.targetLevel === undefined ? .75 : .9,
        availability: 1,
      });
    }
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
  for (const candidate of candidates) {
    if (candidate.kind !== "upgrade") continue;
    if (candidate.category === "builder backlog") continue;
    const role = roles.units[candidate.subject] ?? roles.categories[candidate.category] ?? "useful progression";
    const factors: string[] = [];
    if (candidate.thCapLevel && candidate.thCapLevel > (candidate.targetLevel ?? 1) - 1) {
      const gap = candidate.thCapLevel - ((candidate.targetLevel ?? 1) - 1);
      factors.push(`${gap} level${gap === 1 ? "" : "s"} below your TH${player.townHallLevel} cap`);
    }
    if (candidate.notes.some((note) => note.includes("war army") || note.includes("home army") || note.includes("hero lineup"))) {
      const fitNote = candidate.notes.find((note) => note.includes("war army") || note.includes("home army") || note.includes("hero lineup"))!;
      factors.push(fitNote.replace(/\.$/, "").replace(/^./, (character) => character.toLowerCase()));
    }
    if (candidate.affordable === true) factors.push("affordable with entered resources");
    else if (candidate.affordable === false) factors.push("above entered resources");
    factors.push(`${durationLabel(candidate.rawTime ?? 0)} ${candidate.category === "lab upgrade" ? "in the laboratory" : "of upgrade time"}`);
    if (candidate.category === "lab upgrade" && timerContext?.buildersBusy) factors.push("lab work while all builders are busy");
    if (candidate.activeTimer) factors.push("already in progress (timer)");
    if (candidate.magicSuggestion) factors.push(candidate.magicSuggestion);
    if (goal !== "balanced") factors.push(`supports your ${goal} goal`);
    candidate.why = `${candidate.subject} is ${role}; ${factors.slice(0, 4).join(", ")}.`;
  }
  for (const candidate of candidates.filter((item) => item.kind === "unlock")) {
    candidate.score = 0.75 / (1.15 * 1.15);
  }

  const rankedUpgrades = upgrades.sort((a, b) => Number(Boolean(b.prioritySelected)) - Number(Boolean(a.prioritySelected)) || b.score - a.score);
  const priorityUpgrades = rankedUpgrades.filter((candidate) => candidate.prioritySelected);
  const backlogUpgrades = rankedUpgrades.filter((candidate) => candidate.category === "builder backlog");
  const otherUpgrades = rankedUpgrades.filter((candidate) => !candidate.prioritySelected && candidate.category !== "builder backlog");
  const unlocks = candidates.filter((candidate) => candidate.kind === "unlock");
  const hints = candidates.filter((candidate) => candidate.kind === "hint").sort((a, b) => b.score - a.score);
  return [...priorityUpgrades, ...backlogUpgrades, ...otherUpgrades.slice(0, 3), ...unlocks, ...otherUpgrades.slice(3), ...hints]
    .slice(0, 20)
    .map(({ kind: _kind, rawCost: _cost, rawTime: _time, strategic: _strategic, availability: _availability, gate: _gate, confidenceFactor: _confidence, prioritySelected: _prioritySelected, ...action }) => action);
}

function upgrade(item: { nextUpgrade: Upgrade | null }) {
  return item.nextUpgrade;
}
