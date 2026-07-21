import { describe, expect, it, vi } from "vitest";
import { collectWatched, extractAttackRows, rawObjectKey, shouldRunDailyCollection, writeAttackEvents } from "../src/collector";

function bucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    put: vi.fn(async (key: string, value: string) => objects.set(key, value)),
    get: vi.fn(async (key: string) => objects.has(key) ? { text: async () => objects.get(key)! } : null),
  };
}

describe("collector", () => {
  it("gates the daily pass and produces stable raw keys", () => {
    expect(shouldRunDailyCollection(new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString())).toBe(true);
    expect(shouldRunDailyCollection(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())).toBe(false);
    expect(rawObjectKey("players", "2026-07-21", "#2PYC")).toBe("raw/players/2026-07-21/2PYC.jsonl");
  });

  it("joins only strictly older snapshots to attack rows", () => {
    const war = {
      state: "inWar",
      teamSize: 5,
      clan: { members: [{ tag: "#A", name: "A", townHallLevel: 10, mapPosition: 1, attacks: [{ order: 1, stars: 2, destructionPercentage: 80, defenderTag: "#D" }] }] },
      opponent: { members: [{ tag: "#D", name: "D", townHallLevel: 10, mapPosition: 1 }] },
    } as never;
    const rows = extractAttackRows(war, "2026-07-21T12:00:00Z", [
      { fetchedAt: "2026-07-21T11:00:00Z", player: { tag: "#A", name: "A", townHallLevel: 10, heroes: [{ name: "King", level: 50 }] } },
      { fetchedAt: "2026-07-21T12:00:00Z", player: { tag: "#A", name: "A", townHallLevel: 10, heroes: [{ name: "King", level: 99 }] } },
    ]);
    expect(rows[0].attackerHeroLevels).toEqual({ King: 50 });
    expect(rows[0].snapshot_observed_at).toBe("2026-07-21T11:00:00Z");
  });

  it("writes attack rows idempotently", async () => {
    const data = bucket();
    const row = { attackerTag: "#A", warIdentity: "2026-07-21T10:00:00Z", order: 1, stars: 2, destruction: 80, fetched_at: "2026-07-21T12:00:00Z", mode: "regular" as const };
    await writeAttackEvents(data as never, [row, row], "2026-07-21");
    await writeAttackEvents(data as never, [{ ...row, fetched_at: "2026-07-21T12:05:00Z" }], "2026-07-21");
    expect((data.objects.get("events/attacks/2026-07-21.jsonl")!.match(/\n/g) || []).length).toBe(1);
  });

  it("does not run daily API calls inside the recent gate", async () => {
    const state = { get: vi.fn().mockResolvedValue(new Date().toISOString()), put: vi.fn() };
    const client = { getPlayer: vi.fn() };
    const result = await collectWatched(client as never, bucket() as never, state as never, ["2PYC"], [], new Date());
    expect(result.daily).toBe(false);
    expect(client.getPlayer).not.toHaveBeenCalled();
  });
});
