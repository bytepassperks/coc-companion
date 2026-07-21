import type { NotificationEvent, Snapshot } from "./types";
import { CocClient } from "./cocClient";

export interface NotificationConfig {
  shield_expiring_lead_minutes: number;
  clan_games_ending_lead_hours: number;
  feed_max_items: number;
}

export interface NotificationResult {
  snapshot: Snapshot;
  events: NotificationEvent[];
  changed: boolean;
}

export interface NotificationStore {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
}

export async function collectNotifications(
  tag: string,
  client: CocClient,
  state: NotificationStore,
  config: NotificationConfig,
): Promise<NotificationResult> {
  const kv = state;
  const player = await client.getPlayer(tag);
  const clanTag = player.clan?.tag;
  const goldPassPromise = client.getGoldPassSeason().catch(() => undefined);
  const [clan, currentWar, raidResponse] = clanTag
    ? await Promise.all([
        client.getClan(clanTag).catch(() => undefined),
        client.getCurrentWar(clanTag).catch(() => undefined),
        client.getCapitalRaidSeasons(clanTag).catch(() => ({ items: [] })),
      ])
    : [undefined, undefined, { items: [] }];
  const goldPassSeason = await goldPassPromise;
  const snapshot: Snapshot = {
    fetchedAt: new Date().toISOString(),
    player,
    clan,
    currentWar,
    raidSeasons: raidResponse.items,
    goldPassSeason,
  };
  const key = `state:${normalizeTag(tag)}`;
  const previous = (await kv.get<Snapshot>(key, "json")) ?? undefined;
  const events = diffSnapshots(previous, snapshot, config);
  const changed = snapshotFingerprint(previous) !== snapshotFingerprint(snapshot);
  if (changed) {
    await kv.put(key, JSON.stringify(snapshot));
    if (events.length > 0) {
      const feedKey = `feed:${normalizeTag(tag)}`;
      const current = (await kv.get<NotificationEvent[]>(feedKey, "json")) ?? [];
      const feed = [...events, ...current].slice(0, config.feed_max_items);
      await kv.put(feedKey, JSON.stringify(feed));
    }
  }
  return { snapshot, events, changed };
}

export function diffSnapshots(
  previous: Snapshot | undefined,
  current: Snapshot,
  _config: NotificationConfig,
): NotificationEvent[] {
  if (!previous) return [];
  const events: NotificationEvent[] = [];
  const now = new Date().toISOString();
  for (const hero of current.player.heroes ?? []) {
    const before = previous.player.heroes?.find((item) => item.name === hero.name);
    if (before && hero.level > before.level) {
      events.push({
        id: `hero:${hero.name}:${hero.level}:${current.player.tag}`,
        type: "upgrade_completed",
        createdAt: now,
        message: `${hero.name} reached level ${hero.level}.`,
        data: { subject: hero.name, level: hero.level },
      });
    }
  }
  for (const troop of current.player.troops ?? []) {
    const before = previous.player.troops?.find((item) => item.name === troop.name);
    if (before && troop.level > before.level) {
      events.push({
        id: `troop:${troop.name}:${troop.level}:${current.player.tag}`,
        type: "upgrade_completed",
        createdAt: now,
        message: `${troop.name} reached level ${troop.level}.`,
        data: { subject: troop.name, level: troop.level },
      });
    }
  }
  if (previous.currentWar?.state !== current.currentWar?.state &&
      (current.currentWar?.state === "preparation" || current.currentWar?.state === "inWar")) {
    events.push({
      id: `war:${current.currentWar.state}:${current.player.tag}:${current.fetchedAt}`,
      type: "war_window_open",
      createdAt: now,
      message: `Clan war state changed to ${current.currentWar.state}; attack window is open.`,
      data: { state: current.currentWar.state },
    });
  }
  const raid = current.raidSeasons?.[0];
  const oldRaid = previous.raidSeasons?.[0];
  if (raid?.state === "ongoing" && oldRaid?.state !== "ongoing") {
    events.push({
      id: `raid:${raid.startTime ?? current.fetchedAt}:${current.player.tag}`,
      type: "capital_raid_active",
      createdAt: now,
      message: "Capital Raid Weekend is active.",
    });
  }
  return events;
}

function normalizeTag(tag: string) {
  return tag.replace(/^#/, "");
}

function snapshotFingerprint(snapshot: Snapshot | undefined): string {
  if (!snapshot) return "";
  const heroLevels = Object.fromEntries(
    (snapshot.player.heroes ?? []).map((hero) => [hero.name, hero.level] as [string, number]).sort(([a], [b]) => a.localeCompare(b)),
  );
  const troopLevels = Object.fromEntries(
    (snapshot.player.troops ?? []).map((troop) => [troop.name, troop.level] as [string, number]).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({
    heroLevels,
    troopLevels,
    currentWarState: snapshot.currentWar?.state,
    raidState: snapshot.raidSeasons?.[0]?.state,
    goldPassStartTime: snapshot.goldPassSeason?.startTime,
    townHallLevel: snapshot.player.townHallLevel,
  });
}
