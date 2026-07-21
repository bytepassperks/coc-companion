import { describe, expect, it } from "vitest";
import { getRecommendations } from "../src/recommendationEngine";
import type { Player } from "../src/types";
import config from "../config/upgrade-priorities.json";

describe("recommendationEngine", () => {
  it("is config-driven and passes the config update stamp", () => {
    const player: Player = {
      tag: "#2ABC",
      name: "Chief",
      townHallLevel: 18,
      heroes: [{ name: "Barbarian King", level: 100, maxLevel: 110 }],
      troops: [{ name: "Dragon", level: 8, maxLevel: 10 }],
    };
    const recommendations = getRecommendations(player, config as unknown as Parameters<typeof getRecommendations>[1]);
    expect(recommendations[0]?.category).toBe("clan_castle");
    expect(recommendations.some(item => item.subject === "Barbarian King")).toBe(true);
    expect(recommendations.some(item => item.subject === "Dragon")).toBe(true);
    expect(recommendations.every(item => item.lastUpdated === "2026-07-21")).toBe(true);
  });
});
