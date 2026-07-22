import { describe, expect, it } from "vitest";
import { analyzeAccount } from "../src/analyzer";
import { getNextBestActions } from "../src/nextBestAction";
import type { GameCatalog, Player } from "../src/types";
import fullCatalog from "../config/game-data.json";
import { inferBuilderBacklog } from "../src/builderBacklog";

const catalog: GameCatalog = {
  metadata: { source: "test", upstream: "test", accessed: "2026-07-21", game_version: "test" },
  heroes: [{ name: "King", village: "home", resource: "Dark Elixir", levels: [
    { level: 1, required_townhall: 7, upgrade_cost: 1000, upgrade_time: 1000 },
    { level: 2, required_townhall: 7, upgrade_cost: 2000, upgrade_time: 1000 },
  ] }],
  troops: [{ name: "Cheap", village: "home", resource: "Elixir", levels: [
    { level: 1, required_townhall: 7, upgrade_cost: 100, upgrade_time: 10 },
    { level: 2, required_townhall: 7, upgrade_cost: 100, upgrade_time: 10 },
  ] }],
  spells: [],
  buildings: [],
  traps: [],
};
const player: Player = {
  tag: "#2PYC", name: "Test", townHallLevel: 7, warPreference: "in",
  heroes: [{ name: "King", level: 1 }], troops: [{ name: "Cheap", level: 1, village: "home" }],
};

describe("next best action", () => {
  it("infers unique backlog levels and leaves ambiguous costs honest", () => {
    const fake = { ...catalog, buildings: [
      { name: "Tower", village: "home", resource: "Gold", levels: [{ level: 2, upgrade_cost: 100 }] },
      { name: "Tower", village: "home", resource: "Gold", levels: [{ level: 3, upgrade_cost: 200 }] },
      { name: "Ambiguous", village: "home", resource: "Gold", levels: [{ level: 2, upgrade_cost: 100 }, { level: 3, upgrade_cost: 100 }] },
    ] } as GameCatalog;
    expect(inferBuilderBacklog([{ name: "Tower", count: 1, cost: 200 }], fake)[0].targetLevel).toBe(3);
    expect(inferBuilderBacklog([{ name: "Ambiguous", count: 1, cost: 100 }], fake)[0].targetLevel).toBeUndefined();
    const discounted = { ...catalog, buildings: [
      { name: "Discounted Tower", village: "home", resource: "Gold", levels: [{ level: 7, upgrade_cost: 10000000 }] },
    ] } as GameCatalog;
    const discountedResult = inferBuilderBacklog([{ name: "Discounted Tower", count: 1, cost: 8000000 }], discounted)[0];
    expect(discountedResult.targetLevel).toBe(7);
    expect(discountedResult.provenance).toBe("inferred from discounted cost (Gold Pass boost)");
    const ambiguousDiscount = { ...catalog, buildings: [
      { name: "Discounted Tower", village: "home", resource: "Gold", levels: [{ level: 7, upgrade_cost: 10000000 }, { level: 8, upgrade_cost: 9411765 }] },
    ] } as GameCatalog;
    expect(inferBuilderBacklog([{ name: "Discounted Tower", count: 1, cost: 8000000 }], ambiguousDiscount)[0].targetLevel).toBeUndefined();
  });

  it("ranks impactful builder backlog items before lower-impact buildings", () => {
    const analysis = analyzeAccount(player, catalog);
    const actions = getNextBestActions(player, catalog, analysis, {
      buildersFree: 1, builderBacklog: [
        { name: "Gold Mine", count: 1, cost: 6400000, resource: "Gold" },
        { name: "X-Bow", count: 1, cost: 8000000, resource: "Gold", targetLevel: 8 },
      ], updatedAt: "",
    });
    expect(actions.findIndex((item) => item.subject === "X-Bow")).toBeLessThan(actions.findIndex((item) => item.subject === "Gold Mine"));
    expect(actions.find((item) => item.subject === "X-Bow")?.why).toContain("8");
  });
  it("penalizes hero downtime for war, boosts cheap farm actions, and gates builders", () => {
    const analysis = analyzeAccount(player, catalog);
    const war = getNextBestActions(player, catalog, analysis, { goal: "war", labBusy: false, buildersFree: 1, updatedAt: "" });
    const farm = getNextBestActions(player, catalog, analysis, { goal: "farm", labBusy: false, buildersFree: 1, updatedAt: "" });
    expect(war.find((item) => item.category === "hero upgrade")!.score).toBeLessThan(
      farm.find((item) => item.category === "hero upgrade")!.score,
    );
    expect(farm[0].category).toBe("lab upgrade");
    const gated = getNextBestActions(player, catalog, analysis, { goal: "balanced", buildersFree: 0, updatedAt: "" });
    expect(gated.find((item) => item.category === "hero upgrade")!.notes).toContain("No free builder.");
  });

  it("marks affordable actions and applies affordability boost", () => {
    const analysis = analyzeAccount(player, catalog);
    const actions = getNextBestActions(player, catalog, analysis, {
      goal: "balanced", buildersFree: 1, resources: { elixir: 1000, darkElixir: 0 }, updatedAt: "",
    });
    expect(actions.find((item) => item.subject === "Cheap")?.affordable).toBe(true);
    expect(actions.find((item) => item.subject === "King")?.affordable).toBe(false);
  });

  it("boosts research for the selected army and explains the boost", () => {
    const analysis = analyzeAccount(player, catalog);
    const actions = getNextBestActions(player, catalog, analysis, {
      goal: "war", warArmy: ["Cheap"], buildersFree: 1, updatedAt: "",
    });
    const cheap = actions.find((item) => item.subject === "Cheap");
    expect(cheap?.notes).toContain("In your war army.");
    expect(cheap?.why).toContain("in your war army");
  });

  it("keeps the selected TH16 army research above non-army lab items", () => {
    const th16Catalog: GameCatalog = {
      ...catalog,
      troops: ["Baby Dragon", "Valkyrie", "Minion", "Battle Blimp"].map((name, index) => ({
        name, village: "home", levels: [
          { level: 1, required_townhall: 10, upgrade_cost: 1000 + index * 100, upgrade_time: 1000 },
          { level: 2, required_townhall: 10, upgrade_cost: 1200 + index * 100, upgrade_time: 1000 },
          { level: 3, required_townhall: 16, upgrade_cost: 1400 + index * 100, upgrade_time: 1000 },
        ],
      })),
      spells: [{ name: "Revive Spell", village: "home", levels: [
        { level: 1, required_townhall: 10, upgrade_cost: 1000, upgrade_time: 1000 },
        { level: 2, required_townhall: 16, upgrade_cost: 1200, upgrade_time: 1000 },
      ] }],
    };
    const th16Player: Player = {
      tag: "#2PVR0VL89", name: "TH16", townHallLevel: 16,
      troops: [
        { name: "Baby Dragon", level: 1, village: "home" },
        { name: "Valkyrie", level: 1, village: "home" },
        { name: "Minion", level: 1, village: "home" },
        { name: "Battle Blimp", level: 1, village: "home" },
      ],
      spells: [{ name: "Revive Spell", level: 1 }],
    };
    const actions = getNextBestActions(th16Player, th16Catalog, analyzeAccount(th16Player, th16Catalog), {
      goal: "war", warArmy: ["Dragon", "Balloon", "Baby Dragon", "Lightning Spell", "Revive Spell", "Freeze Spell", "Battle Blimp"], updatedAt: "",
    });
    expect(actions.findIndex((item) => item.subject === "Baby Dragon")).toBeGreaterThanOrEqual(0);
    expect(actions.find((item) => item.subject === "Baby Dragon")?.notes).toContain("In your war army.");
    expect(actions.findIndex((item) => item.subject === "Baby Dragon")).toBeLessThan(actions.findIndex((item) => item.subject === "Valkyrie"));
  });

  it("ranks a selected hero with army research while deprioritizing active timers", () => {
    const analysis = analyzeAccount(player, catalog);
    const actions = getNextBestActions(player, catalog, analysis, {
      goal: "war", warArmy: ["Cheap"], heroLineup: ["King"], buildersFree: 1, updatedAt: "",
    }, { buildersBusy: true, activeLabels: ["Cheap"] });
    const king = actions.find((item) => item.subject === "King");
    const cheap = actions.find((item) => item.subject === "Cheap");
    expect(king?.notes).toContain("In your hero lineup.");
    expect(king?.why).toContain("in your hero lineup");
    expect(cheap?.notes).toContain("Already in progress (timer).");
    expect(cheap?.why).toContain("lab work while all builders are busy");
    expect(actions.find((item) => item.notes.includes("Already in progress (timer)."))).toBeDefined();
  });

  it("suggests owned magic items on matching upgrades and adds Clan Games", () => {
    const analysis = analyzeAccount(player, catalog);
    const actions = getNextBestActions(player, catalog, analysis, {
      goal: "war", magicItems: { bookOfHeroes: 1, researchPotion: 1 }, clanGamesActive: true, wallLevel: 15, wallCount: 120, updatedAt: "",
    });
    const hero = actions.find((item) => item.subject === "King");
    expect(hero?.notes.some((note) => note.includes("Book of Heroes"))).toBe(true);
    expect(hero?.why).toContain("Book of Heroes");
    expect(actions.find((item) => item.action === "Complete Clan Games challenges")?.why).toContain("magic-item rewards");
    expect(actions.find((item) => item.action === "Plan wall upgrades")?.why).toContain("120 walls");
  });

  it("caps unlock actions and includes the prerequisite building", () => {
    const analysis = analyzeAccount(player, catalog);
    analysis.unlockable = Array.from({ length: 8 }, (_, index) => ({
      name: `Unlockable ${index}`,
      category: "troops",
      building: "Dark Barracks",
      provenance: "calculated" as const,
    }));
    const actions = getNextBestActions(player, catalog, analysis);
    const unlocks = actions.filter((item) => item.category === "unlock troops");
    expect(unlocks.length).toBe(5);
    expect(unlocks[0].action).toContain("requires Dark Barracks");
  });

  it("does not create an upgrade action for a locked TH7 Minion", () => {
    const th7: Player = {
      tag: "#2PYC",
      name: "TH7",
      townHallLevel: 7,
      heroes: [{ name: "Barbarian King", level: 1 }],
      troops: [{ name: "Barbarian", level: 3, village: "home" }],
      spells: [],
    };
    const analysis = analyzeAccount(th7, fullCatalog as unknown as GameCatalog);
    const actions = getNextBestActions(th7, fullCatalog as unknown as GameCatalog, analysis);
    expect(analysis.categories.troops.items.find((item) => item.name === "Minion")?.nextUpgrade).toBeNull();
    expect(actions.some((item) => item.action === "Upgrade Minion")).toBe(false);
    expect(actions.some((item) => item.action.startsWith("Unlock Minion"))).toBe(true);
  });

  it("keeps high-TH upgrade scores useful and ranks them above the manual hint", () => {
    const highCatalog: GameCatalog = {
      metadata: { source: "test", upstream: "test", accessed: "2026-07-21", game_version: "test" },
      heroes: [{ name: "King", village: "home", resource: "Dark Elixir", levels: [
        { level: 1, required_townhall: 16, upgrade_cost: 120000, upgrade_time: 432000 },
        { level: 2, required_townhall: 16, upgrade_cost: 130000, upgrade_time: 518400 },
      ] }],
      troops: [{ name: "Heavy", village: "home", resource: "Elixir", levels: [
        { level: 1, required_townhall: 16, upgrade_cost: 160000, upgrade_time: 691200 },
        { level: 2, required_townhall: 16, upgrade_cost: 180000, upgrade_time: 691200 },
      ] }, { name: "Cheap", village: "home", resource: "Elixir", levels: [
        { level: 1, required_townhall: 16, upgrade_cost: 20000, upgrade_time: 86400 },
        { level: 2, required_townhall: 16, upgrade_cost: 25000, upgrade_time: 86400 },
      ] }],
      spells: [],
      buildings: [],
      traps: [],
    };
    const highPlayer: Player = {
      tag: "#2PYC", name: "TH16", townHallLevel: 16,
      heroes: [{ name: "King", level: 1 }],
      troops: [{ name: "Heavy", level: 1, village: "home" }, { name: "Cheap", level: 1, village: "home" }],
      spells: [],
    };
    const analysis = analyzeAccount(highPlayer, highCatalog);
    const actions = getNextBestActions(highPlayer, highCatalog, analysis);
    expect(actions[0].category).not.toBe("base data");
    expect(actions[0].score).toBeGreaterThan(0.1);
    expect(actions.find((item) => item.category === "base data")?.score).toBe(0.05);
    expect(actions.some((item) => item.score > 0.1)).toBe(true);
  });
});
