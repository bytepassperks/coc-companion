import { describe, expect, it } from "vitest";
import { adviseEquipment } from "../src/equipmentAdvisor";
import { calculateRushScore } from "../src/rushScore";
import { activeTimers, expireTimers, validateTimerInput } from "../src/timers";
import type { GameCatalog, Player, UpgradeTimer } from "../src/types";

const catalog: GameCatalog = {
  metadata: { source: "test", upstream: "test", accessed: "2026-07-21", game_version: "test" },
  heroes: [{
    name: "Barbarian King", village: "home", levels: [
      { level: 1, required_townhall: 6 }, { level: 2, required_townhall: 7 }, { level: 3, required_townhall: 8 },
    ],
  }],
  troops: [{
    name: "Barbarian", village: "home", levels: [
      { level: 1, required_townhall: 5 }, { level: 2, required_townhall: 6 }, { level: 3, required_townhall: 7 },
    ],
  }],
  spells: [{
    name: "Lightning Spell", village: "home", levels: [
      { level: 1, required_townhall: 5 }, { level: 2, required_townhall: 7 },
    ],
  }],
  buildings: [], traps: [],
};

describe("manual timers", () => {
  it("validates bounded future durations and expires old entries", () => {
    const now = Date.parse("2026-07-21T00:00:00.000Z");
    expect(validateTimerInput({ kind: "builder", label: "Archer Tower", durationSeconds: 3600 }, now).endsAt).toBe("2026-07-21T01:00:00.000Z");
    expect(() => validateTimerInput({ kind: "builder", label: "x", durationSeconds: 0 }, now)).toThrow("future");
    expect(() => validateTimerInput({ kind: "builder", label: "x", durationSeconds: 31 * 86400 }, now)).toThrow("30 days");
    const timers: UpgradeTimer[] = [{ id: "old", kind: "builder", label: "Old", startedAt: "", endsAt: "2026-07-17T00:00:00.000Z", notified: true }];
    expect(expireTimers(timers, now)).toHaveLength(0);
    expect(activeTimers(timers, now)).toHaveLength(0);
  });
});

describe("rush score", () => {
  it("uses the previous Town Hall caps and reports a TH7 shortfall", () => {
    const player: Player = {
      tag: "#2PYC", name: "TH7", townHallLevel: 7,
      heroes: [{ name: "Barbarian King", level: 1 }],
      troops: [{ name: "Barbarian", level: 2, village: "home" }],
      spells: [{ name: "Lightning Spell", level: 1 }],
    };
    const analysis = {
      townHallLevel: 7, categories: {
        heroes: { items: [{ name: "Barbarian King", level: 1, thCapLevel: 2, remainingLevels: 1, provenance: "observed", nextUpgrade: null }], completion: .5, provenance: "calculated" },
        troops: { items: [{ name: "Barbarian", level: 2, thCapLevel: 3, remainingLevels: 1, provenance: "observed", nextUpgrade: null }], completion: .66, provenance: "calculated" },
        spells: { items: [{ name: "Lightning Spell", level: 1, thCapLevel: 2, remainingLevels: 1, provenance: "observed", nextUpgrade: null }], completion: .5, provenance: "calculated" },
        builderBase: { items: [], completion: 1, provenance: "calculated" },
      }, overallCompletion: .6, unlockable: [], achievements: [], provenance: "calculated",
    } as never;
    const report = calculateRushScore(player, analysis, catalog);
    expect(report.categories.find((item) => item.name === "Heroes")?.completion).toBe(1);
    expect(report.categories.find((item) => item.name === "Offense troops")?.rushed).toBe(false);
    expect(report.verdict).toBe("ready");
  });
});

describe("equipment advisor ore affordability", () => {
  it("echoes affordability and prioritizes an affordable recommended item", () => {
    const player: Player = {
      tag: "#2PYC", name: "Equipment", townHallLevel: 16,
      heroes: [{ name: "Archer Queen", level: 80 }],
      heroEquipment: [
        { name: "Frozen Arrow", level: 16, maxLevel: 27 },
        { name: "Healer Puppet", level: 16, maxLevel: 27 },
      ],
    };
    const advice = adviseEquipment(player, "war", { shiny: 1088, glowy: 187, starry: 467 });
    expect(advice.equipment[0].oreCost).toEqual({ shiny: 120, glowy: 60, starry: 0 });
    expect(advice.equipment[0].affordable).toBe(true);
    expect(advice.equipment[0].priority).toContain("affordable now");
    expect(adviseEquipment(player, "war", { shiny: 0, glowy: 0, starry: 0 }).equipment[0].affordable).toBe(false);
  });

  it("finds pets in the troop payload and plans toward the nearest breakpoint", () => {
    const player: Player = {
      tag: "#2PYC", name: "Pets", townHallLevel: 16,
      heroes: [{ name: "Archer Queen", level: 80 }],
      heroEquipment: [{ name: "Frozen Arrow", level: 16 }],
      troops: [
        { name: "Spirit Fox", level: 10, village: "home" },
      ],
    };
    const plan = adviseEquipment(player, "war", { shiny: 1088, glowy: 187, starry: 467 }, ["Archer Queen"]);
    expect(plan.equipment[0].nextBreakpoint).toBe(18);
    expect(plan.equipment[0].priority).toContain("2 levels");
    expect(plan.pets[0].name).toBe("Spirit Fox");
    expect(plan.pets[0].priority).toContain("laboratory time");
  });
});
