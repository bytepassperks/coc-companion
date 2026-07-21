import { mkdir, open } from "node:fs/promises";

const API_KEY = process.env.COC_API_KEY;
const BASE = (process.env.COC_API_BASE_URL || "https://cocproxy.royaleapi.dev/v1").replace(/\/$/, "");
const OUT = process.env.ATTACKS_OUTPUT || "/home/ubuntu/corpus/attacks.jsonl";
const MAX_REQUESTS = Number(process.env.COLLECT_REQUEST_BUDGET || 4000);
const MAX_CLANS = Number(process.env.COLLECT_MAX_CLANS || 180);
const PLAYER_SAMPLE_RATE = 0.15;
if (!API_KEY) throw new Error("COC_API_KEY is required");

let requests = 0;
let lastRequestAt = 0;
const playerCache = new Map();
const clanTags = new Set();

async function api(path, attempt = 0) {
  if (requests >= MAX_REQUESTS) throw new Error("request budget exhausted");
  const wait = Math.max(0, 125 - (Date.now() - lastRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  requests += 1;
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
  });
  if (response.status === 429 && attempt < 4) {
    const retryAfter = Number(response.headers.get("Retry-After") || 1);
    await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, 250 * 2 ** attempt)));
    return api(path, attempt + 1);
  }
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`GET ${path}: ${response.status} ${body.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function tagPath(tag) {
  return encodeURIComponent(tag);
}

async function discover() {
  const locations = await api("/locations");
  const countries = (locations.items || [])
    .filter((location) => location.isCountry && location.id !== 32000000)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .slice(0, 14);
  const selected = [{ id: 32000000, name: "Global" }, ...countries];
  for (const location of selected) {
    try {
      const page = await api(`/locations/${location.id}/rankings/clans?limit=25`);
      for (const clan of page.items || []) if (clan.tag) clanTags.add(clan.tag);
    } catch (error) {
      console.warn(`rankings unavailable for ${location.name}: ${error.message}`);
    }
  }
  let cursor;
  for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
    const query = new URLSearchParams({ warFrequency: "always", minMembers: "30", limit: "50" });
    if (cursor) query.set("after", cursor);
    try {
      const page = await api(`/clans?${query}`);
      for (const clan of page.items || []) if (clan.tag) clanTags.add(clan.tag);
      cursor = page.paging?.cursors?.after;
      if (!cursor) break;
    } catch (error) {
      console.warn(`clan search unavailable: ${error.message}`);
      break;
    }
  }
  return [...clanTags].slice(0, MAX_CLANS);
}

function sideMembers(side) {
  return new Map((side?.members || []).map((member) => [member.tag, member]));
}

async function playerHeroTotal(tag) {
  if (playerCache.has(tag)) return playerCache.get(tag);
  if (Math.random() > PLAYER_SAMPLE_RATE) return 0;
  try {
    const player = await api(`/players/${tagPath(tag)}`);
    const total = (player.heroes || []).reduce((sum, hero) => sum + Number(hero.level || 0), 0);
    playerCache.set(tag, total);
    return total;
  } catch (error) {
    if (error.status !== 403 && error.status !== 404) console.warn(`player ${tag} unavailable: ${error.message}`);
    playerCache.set(tag, 0);
    return 0;
  }
}

async function attacksForSide(attackingSide, defendingSide, war, fetchedAt, output) {
  const attackers = sideMembers(attackingSide);
  const defenders = sideMembers(defendingSide);
  for (const attacker of attackers.values()) {
    for (const [index, attack] of (attacker.attacks || []).entries()) {
      const defender = defenders.get(attack.defenderTag);
      output.push({
        attackerTag: attacker.tag,
        warIdentity: war.startTime || war.preparationStartTime || attack.defenderTag || "unknown-war",
        attackerTH: attacker.townhallLevel,
        attackerHeroTotal: await playerHeroTotal(attacker.tag),
        defenderTag: attack.defenderTag,
        defenderTH: defender?.townhallLevel,
        mapPosition: defender?.mapPosition,
        order: attack.order ?? index + 1,
        stars: attack.stars,
        destruction: attack.destructionPercentage,
        warSize: war.teamSize,
        mode: "regular",
        fetched_at: fetchedAt,
      });
    }
  }
}

async function main() {
  await mkdir(new URL("file:///home/ubuntu/corpus/"), { recursive: true });
  const handle = await open(OUT, "w");
  const summary = new Map();
  let rows = 0;
  try {
    const clans = await discover();
    console.log(`Discovered ${clans.length} unique clans; request budget ${MAX_REQUESTS}.`);
    for (const [index, clanTag] of clans.entries()) {
      if (requests >= MAX_REQUESTS) break;
      try {
        const war = await api(`/clans/${tagPath(clanTag)}/currentwar`);
        if (!["inWar", "warEnded"].includes(war.state)) continue;
        const fetchedAt = new Date().toISOString();
        const attackRows = [];
        await attacksForSide(war.clan, war.opponent, war, fetchedAt, attackRows);
        await attacksForSide(war.opponent, war.clan, war, fetchedAt, attackRows);
        for (const row of attackRows) {
          await handle.write(`${JSON.stringify(row)}\n`);
          rows += 1;
          const key = `${row.attackerTH ?? "unknown"}→${row.defenderTH ?? "unknown"}`;
          summary.set(key, (summary.get(key) || 0) + 1);
        }
        if (attackRows.length) console.log(`[${index + 1}/${clans.length}] ${clanTag}: +${attackRows.length} attacks (${rows} total)`);
      } catch (error) {
        if (![403, 404].includes(error.status)) console.warn(`${clanTag}: ${error.message}`);
      }
    }
  } finally {
    await handle.close();
  }
  console.log(`Wrote ${rows} attack rows to ${OUT}; requests=${requests}; sampledPlayers=${playerCache.size}`);
  console.log("Town Hall distribution:");
  for (const [key, count] of [...summary.entries()].sort()) console.log(`  ${key}: ${count}`);
}

await main();
