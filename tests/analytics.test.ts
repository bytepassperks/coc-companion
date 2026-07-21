import { describe, expect, it } from "vitest";
import { analyzeCapital } from "../src/capitalAnalytics";
import { analyzeClan } from "../src/clanAnalytics";
import { analyzeWar } from "../src/warAnalytics";

describe("clan and war analytics", () => {
  it("computes war attacks remaining and unattacked members", () => {
    const result = analyzeWar({
      state: "inWar",
      teamSize: 2,
      startTime: "2026-07-21T00:00:00.000Z",
      endTime: "2026-07-22T00:00:00.000Z",
      clan: {
        tag: "#CLAN",
        name: "Clan",
        stars: 3,
        destructionPercentage: 75,
        members: [
          { tag: "#A", name: "Attacker", townHallLevel: 16, mapPosition: 1, attacks: [{ stars: 3, destructionPercentage: 100 }] },
          { tag: "#B", name: "Waiting", townHallLevel: 15, mapPosition: 2, attacks: [] },
        ],
      },
      opponent: { tag: "#OPP", name: "Opponent", stars: 2, destructionPercentage: 60 },
    }, "#CLAN");
    expect(result.attacksPerMember).toBe(2);
    expect(result.members[0].attacksRemaining).toBe(1);
    expect(result.unattacked.map((member) => member.name)).toEqual(["Waiting"]);
    expect(result.sides[0].stars).toBe(3);
  });

  it("handles not-in-war cleanly", () => {
    expect(analyzeWar({ state: "notInWar" }).message).toContain("not currently");
  });

  it("computes donation ratios and top donors", () => {
    const result = analyzeClan({ tag: "#CLAN", name: "Clan", clanLevel: 10 }, [
      { tag: "#A", name: "Donor", donations: 100, donationsReceived: 50 },
      { tag: "#B", name: "New", donations: 0, donationsReceived: 0 },
    ]);
    expect(result.topDonors[0].name).toBe("Donor");
    expect(result.topDonors[0].donationRatio).toBe(2);
    expect(result.topDonors[1].donationRatio).toBeNull();
    expect(result.inactiveSignalNote).toContain("season counters");
  });

  it("computes capital totals, average loot, and top raiders", () => {
    const result = analyzeCapital({
      state: "ongoing",
      totalAttacks: 10,
      capitalTotalLoot: 5000,
      defensiveReward: 800,
      raidsCompleted: 3,
      enemyDistrictsDestroyed: 4,
      members: [
        { name: "Raider", attackCount: 4, capitalResourcesLooted: 2500 },
        { name: "Second", attackCount: 2, capitalResourcesLooted: 1000 },
      ],
    });
    expect(result.offensiveLoot).toBe(5000);
    expect(result.defensiveLoot).toBe(800);
    expect(result.averageLootPerAttack).toBe(500);
    expect(result.topRaiders[0].name).toBe("Raider");
  });
});
