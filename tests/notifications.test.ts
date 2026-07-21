import { describe, expect, it, vi } from "vitest";
import { collectNotifications, diffSnapshots } from "../src/notifications";
import type { Snapshot } from "../src/types";

const base: Snapshot = {
  fetchedAt: "2026-07-21T00:00:00.000Z",
  player: {
    tag: "#2ABC",
    name: "Chief",
    townHallLevel: 18,
    heroes: [{ name: "Barbarian King", level: 100 }],
    troops: [{ name: "Dragon", level: 8 }],
  },
  raidSeasons: [],
};

describe("notifications diffing", () => {
  it("does not produce events or writes for identical snapshots", () => {
    const events = diffSnapshots(base, { ...base, fetchedAt: base.fetchedAt }, {
      shield_expiring_lead_minutes: 60,
      clan_games_ending_lead_hours: 6,
      feed_max_items: 100,
    });
    expect(events).toEqual([]);
  });

  it("does not write when the API snapshot is unchanged", async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(base),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      getPlayer: vi.fn().mockResolvedValue(base.player),
      getClan: vi.fn().mockResolvedValue(undefined),
      getCurrentWar: vi.fn().mockResolvedValue(base.currentWar),
      getCapitalRaidSeasons: vi.fn().mockResolvedValue({ items: base.raidSeasons }),
      getGoldPassSeason: vi.fn().mockResolvedValue(undefined),
    };
    await collectNotifications("#2ABC", client as never, kv, {
      shield_expiring_lead_minutes: 60,
      clan_games_ending_lead_hours: 6,
      feed_max_items: 100,
    });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("ignores volatile player fields in the write fingerprint", async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(base),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      getPlayer: vi.fn().mockResolvedValue({
        ...base.player,
        donations: 999,
        attackWins: 123,
      }),
      getGoldPassSeason: vi.fn().mockResolvedValue(undefined),
    };
    const result = await collectNotifications("#2ABC", client as never, kv, {
      shield_expiring_lead_minutes: 60,
      clan_games_ending_lead_hours: 6,
      feed_max_items: 100,
    });
    expect(result.changed).toBe(false);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("generates upgrade and war events", () => {
    const current: Snapshot = {
      ...base,
      fetchedAt: "2026-07-21T00:05:00.000Z",
      player: {
        ...base.player,
        heroes: [{ name: "Barbarian King", level: 101 }],
      },
      currentWar: { state: "inWar" },
    };
    const events = diffSnapshots(base, current, {
      shield_expiring_lead_minutes: 60,
      clan_games_ending_lead_hours: 6,
      feed_max_items: 100,
    });
    expect(events.map(event => event.type)).toEqual(["upgrade_completed", "war_window_open"]);
  });

  it("emits a war attack event when a member attack count changes", () => {
    const previous: Snapshot = {
      ...base,
      currentWar: { state: "inWar", clan: { tag: "#CLAN", name: "Clan", members: [{ tag: "#A", name: "Attacker", attacks: [] }] } },
      warFingerprint: { "#A": { attacks: 0, stars: 0 } },
    };
    const current: Snapshot = {
      ...base,
      currentWar: { state: "inWar", clan: { tag: "#CLAN", name: "Clan", members: [{ tag: "#A", name: "Attacker", attacks: [{ stars: 2, destructionPercentage: 80 }] }] } },
      warFingerprint: { "#A": { attacks: 1, stars: 2 } },
    };
    const events = diffSnapshots(previous, current, {
      shield_expiring_lead_minutes: 60,
      clan_games_ending_lead_hours: 6,
      feed_max_items: 100,
    });
    expect(events.some((event) => event.type === "war_attack" && event.message.includes("earned 2 stars"))).toBe(true);
  });
});
