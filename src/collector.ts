import type { R2Bucket, KVNamespace } from "@cloudflare/workers-types";
import type { CocClient } from "./cocClient";
import type { CurrentWar, Player, Snapshot } from "./types";

const SCHEMA_VERSION = "1";
const DAILY_GATE = 20 * 60 * 60;

export interface CollectorStore {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface AttackEvent {
  attackerTag: string;
  warIdentity: string;
  attackerTH?: number;
  attackerHeroLevels?: Record<string, number>;
  defenderTag?: string;
  defenderTH?: number;
  mapPosition?: number;
  order: number;
  stars: number;
  destruction: number;
  warSize?: number;
  mode: "regular" | "cwl";
  fetched_at: string;
  snapshot_observed_at?: string;
}

export function shouldRunDailyCollection(lastRun: string | null, now = Date.now()) {
  return !lastRun || now - Date.parse(lastRun) > DAILY_GATE * 1000;
}

export function rawObjectKey(type: string, date: string, identity: string) {
  return `raw/${type}/${date}/${identity.replace(/^#/, "").replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`;
}

export function extractAttackRows(
  war: CurrentWar | undefined,
  observedAt: string,
  snapshots: Snapshot[] = [],
  mode: "regular" | "cwl" = "regular",
): AttackEvent[] {
  if (!war || (war.state !== "preparation" && war.state !== "inWar" && war.state !== "warEnded")) return [];
  const older = (tag: string) => snapshots
    .filter((snapshot) => snapshot.fetchedAt < observedAt && snapshot.player.tag === tag)
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
  const defenders = new Map((war.opponent?.members ?? []).map((member) => [member.tag, member]));
  const rows: AttackEvent[] = [];
  for (const member of war.clan?.members ?? []) {
    const snapshot = older(member.tag);
    const attacks = member.attacks ?? [];
    attacks.forEach((attack, index) => {
      const defender = defenders.get((attack as { defenderTag?: string }).defenderTag ?? "");
      rows.push({
        attackerTag: member.tag,
        warIdentity: war.startTime ?? war.preparationStartTime ?? (attack as { defenderTag?: string }).defenderTag ?? "unknown-war",
        attackerTH: member.townHallLevel,
        attackerHeroLevels: snapshot?.player.heroes?.reduce<Record<string, number>>((result, hero) => {
          result[hero.name] = hero.level;
          return result;
        }, {}),
        defenderTag: (attack as { defenderTag?: string }).defenderTag,
        defenderTH: defender?.townHallLevel,
        mapPosition: defender?.mapPosition,
        order: (attack as { order?: number }).order ?? index + 1,
        stars: attack.stars,
        destruction: attack.destructionPercentage,
        warSize: war.teamSize,
        mode,
        fetched_at: observedAt,
        snapshot_observed_at: snapshot?.fetchedAt,
      });
    });
  }
  return rows;
}

export async function collectDaily(
  client: CocClient,
  data: R2Bucket,
  state: CollectorStore,
  tags: string[],
  now = new Date(),
) {
  const date = now.toISOString().slice(0, 10);
  const results: Array<{ tag: string; ok: boolean }> = [];
  let rankingCollected = false;
  for (const tag of tags.slice(0, 20)) {
    try {
      const player = await client.getPlayer(`#${tag}`);
      await writeRow(data, rawObjectKey("players", date, tag), player, 200, "player");
      if (!player.clan?.tag) {
        results.push({ tag, ok: true });
        continue;
      }
      const clanTag = player.clan.tag;
      await collectClan(client, data, clanTag, date);
      if (!rankingCollected) {
        await client.getLocationRankings("global").then((value) => writeRow(data, rawObjectKey("rankings", date, "global"), value, 200, "rankings:global")).catch(async (error) => {
          await writeRow(data, rawObjectKey("unavailable", date, "rankings-global"), { reason: error instanceof Error ? error.message : "unavailable" }, errorStatus(error), "rankings:global");
        });
        rankingCollected = true;
      }
      results.push({ tag, ok: true });
    } catch (error) {
      await writeRow(data, rawObjectKey("errors", date, tag), { reason: error instanceof Error ? error.message : "collection failed" }, errorStatus(error), "collection");
      results.push({ tag, ok: false });
    }
  }
  await state.put("collector:last_daily", JSON.stringify(now.toISOString()), { expirationTtl: 172800 });
  return results;
}

export async function collectClan(client: CocClient, data: R2Bucket, clanTag: string, date: string) {
  const jobs: Array<Promise<void>> = [
    client.getClan(clanTag).then((value) => writeRow(data, rawObjectKey("clans", date, clanTag), value, 200, "clan")),
    client.getCurrentWar(clanTag).then((value) => writeRow(data, rawObjectKey("wars", date, clanTag), value, 200, "currentwar")),
    client.getWarLog(clanTag).then((value) => writeRow(data, rawObjectKey("warlogs", date, clanTag), value, 200, "warlog")),
    client.getCapitalRaidSeasons(clanTag).then((value) => writeRow(data, rawObjectKey("capital", date, clanTag), value, 200, "capitalraidseasons")),
  ];
  await Promise.all(jobs.map((job) => job.catch(async (error) => {
    await writeRow(data, rawObjectKey("unavailable", date, clanTag), { reason: error instanceof Error ? error.message : "unavailable" }, errorStatus(error), "clan");
  })));
}

export async function writeAttackEvents(data: R2Bucket, rows: AttackEvent[], date = new Date().toISOString().slice(0, 10)) {
  if (!rows.length) return;
  const key = `events/attacks/${date}.jsonl`;
  const existing = await data.get(key);
  const previous = existing ? (await existing.text()).split("\n").filter(Boolean) : [];
  const ids = new Set(previous.map((line) => {
    try {
      const row = JSON.parse(line) as AttackEvent;
      return `${row.attackerTag}:${row.order}:${row.warIdentity}`;
    } catch {
      return "";
    }
  }));
  const additions = rows.filter((row) => {
    const id = `${row.attackerTag}:${row.order}:${row.warIdentity}`;
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
  if (!additions.length) return;
  await data.put(key, [...previous, ...additions.map((row) => JSON.stringify(row))].join("\n") + "\n");
}

async function writeRow(data: R2Bucket, key: string, payload: unknown, status: number, source: string) {
  const row = {
    source,
    fetched_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    http_status: status,
    ...(status >= 200 && status < 300 ? { data: payload } : { unavailable_reason: payload }),
  };
  await data.put(key, JSON.stringify(row) + "\n");
}

export async function collectWatched(
  client: CocClient,
  data: R2Bucket,
  state: CollectorStore,
  watchedTags: string[],
  snapshots: Snapshot[],
  now = new Date(),
) {
  const daily = shouldRunDailyCollection(await state.get<string>("collector:last_daily", "json"), now.getTime());
  if (daily) await collectDaily(client, data, state, watchedTags, now);
  const activeRows: AttackEvent[] = [];
  for (const tag of watchedTags.slice(0, 20)) {
    const snapshot = snapshots.find((item) => item.player.tag.replace(/^#/, "") === tag.replace(/^#/, ""));
    if (snapshot?.currentWar?.state === "preparation" || snapshot?.currentWar?.state === "inWar" || snapshot?.currentWar?.state === "warEnded") {
      activeRows.push(...extractAttackRows(snapshot.currentWar, snapshot.fetchedAt, snapshots, "regular"));
      await writeRow(data, rawObjectKey("wars-active", now.toISOString().slice(0, 10), tag), snapshot.currentWar, 200, "currentwar");
    }
  }
  await writeAttackEvents(data, activeRows, now.toISOString().slice(0, 10));
  return { daily, attackRows: activeRows.length };
}

function errorStatus(error: unknown) {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : 0;
}
