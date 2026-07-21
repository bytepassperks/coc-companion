import { describe, expect, it } from "vitest";
import { analyzeAccount, thCap } from "../src/analyzer";
import type { GameCatalog, Player } from "../src/types";
import fullCatalog from "../config/game-data.json";

const catalog: GameCatalog = {
  metadata: { source: "test", upstream: "test", accessed: "2026-07-21", game_version: "test" },
  heroes: [{ name: "Barbarian King", village: "home", resource: "Dark Elixir", levels: [
    { level: 1, required_townhall: 7, upgrade_cost: 5, upgrade_time: 10 },
    { level: 2, required_townhall: 7, upgrade_cost: 6, upgrade_time: 10 },
    { level: 3, required_townhall: 8, upgrade_cost: 7, upgrade_time: 10 },
  ] }],
  troops: [{ name: "Barbarian", village: "home", resource: "Elixir", levels: [
    { level: 1, required_townhall: 3, upgrade_cost: 5, upgrade_time: 10 },
    { level: 2, required_townhall: 5, upgrade_cost: 6, upgrade_time: 10 },
    { level: 3, required_townhall: 7, upgrade_cost: 7, upgrade_time: 10 },
  ] }],
  spells: [{ name: "Lightning Spell", village: "home", resource: "Elixir", levels: [
    { level: 1, required_townhall: 5, upgrade_cost: 5, upgrade_time: 10 },
    { level: 2, required_townhall: 7, upgrade_cost: 6, upgrade_time: 10 },
  ] }],
  buildings: [],
  traps: [],
};

const player: Player = {
  tag: "#2PYC",
  name: "Test",
  townHallLevel: 7,
  heroes: [{ name: "Barbarian King", level: 1, maxLevel: 110 }],
  troops: [{ name: "Barbarian", level: 2, maxLevel: 13, village: "home" }],
  spells: [{ name: "Lightning Spell", level: 2, maxLevel: 13 }],
  achievements: [{ name: "Almost there", value: 9, target: 10 }],
};

describe("account analyzer", () => {
  it("caps by required Town Hall and falls back to API max", () => {
    expect(thCap(catalog.heroes[0], 7, 110)).toBe(2);
    expect(thCap({ name: "Unknown", village: "home", levels: [] }, 7, 110)).toBe(110);
  });

  it("calculates TH7 completion and achievement highlights", () => {
    const result = analyzeAccount(player, catalog);
    expect(result.categories.heroes.items[0].thCapLevel).toBe(2);
    expect(result.categories.heroes.items[0].remainingLevels).toBe(1);
    expect(result.categories.troops.completion).toBe(2 / 3);
    expect(result.overallCompletion).toBeGreaterThan(0.5);
    expect(result.achievements[0].name).toBe("Almost there");
  });

  it("uses curated unlock Town Halls and excludes seasonal entries from gaps", () => {
    const th7: Player = {
      tag: "#2PYC",
      name: "TH7",
      townHallLevel: 7,
      heroes: [{ name: "Barbarian King", level: 1 }],
      troops: [
        { name: "Barbarian", level: 3, village: "home" },
        { name: "Minion", level: 1, village: "home" },
        { name: "Pumpkin Barbarian", level: 1, village: "home" },
      ],
      spells: [],
    };
    const result = analyzeAccount(th7, fullCatalog as unknown as GameCatalog);
    const names = result.unlockable.map((item) => item.name);
    expect(names).toContain("Dragon");
    expect(names).toContain("Hog Rider");
    expect(names).not.toContain("Minion");
    expect(names).not.toContain("P.E.K.K.A");
    expect(names).not.toContain("Bowler");
    expect(names).not.toContain("Pumpkin Barbarian");
    expect(result.categories.troops.items.map((item) => item.name)).not.toContain("Pumpkin Barbarian");
  });

  it("excludes super troops from account items and completion", () => {
    const withSuper: Player = {
      ...player,
      troops: [
        { name: "Barbarian", level: 2, maxLevel: 13, village: "home" },
        { name: "Super Barbarian", level: 12, maxLevel: 13, village: "home" },
        { name: "Sneaky Goblin", level: 7, maxLevel: 9, village: "home", superTroopIsActive: true },
      ],
    };
    const result = analyzeAccount(withSuper, fullCatalog as unknown as GameCatalog);
    expect(result.categories.troops.items.some((item) => item.name.startsWith("Super ") || item.name === "Sneaky Goblin")).toBe(false);
    expect(result.categories.troops.completion).toBe(analyzeAccount(player, fullCatalog as unknown as GameCatalog).categories.troops.completion);
  });
});
