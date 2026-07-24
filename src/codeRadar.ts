import type { KVNamespace } from "@cloudflare/workers-types";

export type CodeTier = "official" | "corroborated" | "reported";
export interface RadarCode {
  code: string;
  tier: CodeTier;
  sources: string[];
  firstSeen: string;
  alerted?: boolean;
  preexisting?: boolean;
  stale?: boolean;
  note?: string;
}
export interface RadarSourceStatus {
  source: string;
  url: string;
  fetchedAt: string;
  ok: boolean;
  status?: number;
  error?: string;
  candidates: number;
}

export const CODE_SOURCES = [
  { id: "official-news", url: "https://supercell.com/en/games/clashofclans/blog/", official: true },
  { id: "store", url: "https://store.supercell.com/clashofclans", official: true },
  { id: "u7buy", url: "https://www.u7buy.com/blog/clash-of-clans-codes/", official: false },
  { id: "buffbuff", url: "https://buffbuff.com/blog/clash-of-clans-codes", official: false },
  { id: "ldplayer", url: "https://www.ldplayer.net/blog/clash-of-clans-codes.html", official: false },
] as const;

const KNOWN_CREATOR_CODES = new Set(["NINJA", "JUDO", "ITZU", "CLASHNINJA", "CLASHKING"]);
const COMMON_WORDS = new Set(["CLASHOFCLANS", "SUPERCELL", "REDEEMCODE", "REWARD", "PROMOCODE", "DISCOUNT", "STORECODE", "REGISTER", "EVERYONE", "VALENTINE", "DOWNLOAD", "SUBSCRIBE", "POWERPOINTS", "BRAWLENTINE"]);
const CODE_WORDS = ["ALEX", "CALIBUR", "MAGIC", "GIFT", "SHARE", "GOLD", "BARBARIAN", "CLASH", "HOG", "FIRE", "ICE", "TRUSTY", "TURRET", "ROYAL", "AFFAIR", "REINA", "BARRIGA", "WHEN", "FLY"];
const CONTEXT = /\b(code|codes|redeem|reward|rewards|promo|promotion|store|voucher|claim)\b/i;

export function isLikelyCode(code: string, context = ""): boolean {
  const bare = code.replace(/[!$]+$/, "");
  if (COMMON_WORDS.has(bare) || KNOWN_CREATOR_CODES.has(bare) || bare.length < 8 || bare.length > 16) return false;
  if (/\d/.test(bare) && (bare.match(/\d/g)?.length ?? 0) >= 2) return false;
  if (!/[AEIOU]/.test(bare) || (bare.length === 8 && !/[AEIOU].*[AEIOU]/.test(bare))) return false;
  if (!/[A-Z]/.test(bare) || (!CODE_WORDS.some((word) => bare.includes(word)) && bare.length < 10)) return false;
  const lowerContext = context.toLowerCase();
  if (/\bbrawl\s+stars\b|\bbrawlstars\b/.test(lowerContext) && !/clash\s+of\s+clans|\bclashofclans\b/.test(lowerContext)) return false;
  return true;
}

export function extractCandidateCodes(html: string, sourceUrl: string): string[] {
  const candidates = new Set<string>();
  for (const match of html.matchAll(/\b[A-Z][A-Z0-9]{7,15}[!$]{0,3}(?=\b|[^A-Z0-9!$])/g)) {
    const code = match[0];
    const start = match.index ?? 0;
    const context = html.slice(Math.max(0, start - 140), Math.min(html.length, start + code.length + 140));
    const bare = code.replace(/[!$]+$/, "");
    if (!CONTEXT.test(context) || !isLikelyCode(code, context) || /^\d+$/.test(bare)) continue;
    if (new URL(sourceUrl).hostname.includes("supercell.com") || CONTEXT.test(context)) candidates.add(code);
  }
  return [...candidates];
}

export function codeTier(record: Pick<RadarCode, "sources">): CodeTier {
  if (record.sources.some((source) => source.startsWith("official-news") || source.startsWith("store"))) return "official";
  return record.sources.length >= 2 ? "corroborated" : "reported";
}

export function mergeRadarCode(previous: RadarCode | undefined, code: string, source: string, now = new Date().toISOString()): { record: RadarCode; isNew: boolean } {
  const record: RadarCode = previous
    ? { ...previous, sources: [...new Set([...previous.sources, source])] }
    : { code, tier: "reported", sources: [source], firstSeen: now, alerted: false };
  if (record.stale && (source === "official-news" || source === "store")) {
    record.stale = false;
    record.note = undefined;
    record.alerted = false;
  }
  record.tier = codeTier(record);
  return { record, isNew: !previous };
}

async function fetchSource(source: typeof CODE_SOURCES[number]): Promise<{ status: RadarSourceStatus; codes: string[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(source.url, { headers: { "User-Agent": "CoC-Companion-Code-Radar/1.0" }, signal: controller.signal });
    const text = await response.text();
    return {
      status: { source: source.id, url: source.url, fetchedAt: new Date().toISOString(), ok: response.ok, status: response.status, candidates: response.ok ? extractCandidateCodes(text, source.url).length : 0 },
      codes: response.ok ? extractCandidateCodes(text, source.url) : [],
    };
  } catch (error) {
    return { status: { source: source.id, url: source.url, fetchedAt: new Date().toISOString(), ok: false, error: error instanceof Error ? error.message : "fetch failed", candidates: 0 }, codes: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export async function seedRadarCodes(state: KVNamespace): Promise<void> {
  const seeded = ["FIREANDICE!!", "WHENHOGSFLY!", "TRUSTYTURRET", "ROYALEAFFAIR", "REINABARRIGA"];
  const now = new Date().toISOString();
  for (const code of seeded) {
    const key = `codes:record:${code}`;
    if (await state.get(key)) continue;
    await state.put(key, JSON.stringify({ code, tier: "reported", sources: ["pre-radar-roundup"], firstSeen: now, alerted: true, preexisting: true, note: "Reported before radar activation; likely stale." } satisfies RadarCode));
  }
  const index = await state.get<string[]>("codes:index", "json") ?? [];
  await state.put("codes:index", JSON.stringify([...new Set([...index, ...seeded])]));
}

export async function runCodeRadar(state: KVNamespace, watchedTags: string[], telegramToken?: string, telegramChatId?: string): Promise<void> {
  await seedRadarCodes(state);
  const seeded = new Set(["FIREANDICE!!", "WHENHOGSFLY!", "TRUSTYTURRET", "ROYALEAFFAIR", "REINABARRIGA"]);
  const migrationKey = "codes:migration:user-verified-jul-2026";
  if (!(await state.get(migrationKey))) {
    const userVerified = ["ALEXCALIBUR", "ONEMAGICGIFT", "SHARETHEGOLD", "BARBARIANCWL", ...seeded];
    const now = new Date().toISOString();
    const index = await state.get<string[]>("codes:index", "json") ?? [];
    for (const code of userVerified) {
      const previous = await state.get<RadarCode>(`codes:record:${code}`, "json");
      await state.put(`codes:record:${code}`, JSON.stringify({
        code,
        tier: previous?.tier ?? "reported",
        sources: previous?.sources ?? ["user-verification"],
        firstSeen: previous?.firstSeen ?? now,
        alerted: true,
        preexisting: previous?.preexisting ?? true,
        stale: true,
        note: "User-verified not working (Jul 2026)",
      } satisfies RadarCode));
    }
    await state.put("codes:index", JSON.stringify([...new Set([...index, ...userVerified])]));
    await state.put(migrationKey, "1");
  }
  const initialIndex = await state.get<string[]>("codes:index", "json") ?? [];
  const cleanIndex: string[] = [];
  for (const code of initialIndex) {
    if (seeded.has(code) || isLikelyCode(code)) cleanIndex.push(code);
    else await state.delete(`codes:record:${code}`);
  }
  await state.put("codes:index", JSON.stringify(cleanIndex));
  const results = await Promise.all(CODE_SOURCES.map(fetchSource));
  for (const result of results) await state.put(`codes:source:${result.status.source}`, JSON.stringify(result.status));
  const index = await state.get<string[]>("codes:index", "json") ?? [];
  const known = new Set(index);
  for (const result of results) for (const code of result.codes) {
    const previous = (await state.get<RadarCode>(`codes:record:${code}`, "json")) ?? undefined;
    const merged = mergeRadarCode(previous, code, result.status.source);
    await state.put(`codes:record:${code}`, JSON.stringify(merged.record));
    known.add(code);
    if (merged.record.stale) continue;
    if (!merged.isNew && merged.record.alerted) continue;
    merged.record.alerted = true;
    await state.put(`codes:record:${code}`, JSON.stringify(merged.record));
    const confidence = merged.record.tier === "official"
      ? "Officially published by Supercell; validity can still change."
      : merged.record.tier === "corroborated"
        ? "Found on multiple community sources; validity can still change."
        : "Unverified — found on a community roundup, often stale.";
    const message = `CoC code found: ${code} (${merged.record.tier}). ${confidence}`;
    for (const tag of watchedTags) {
      const key = `feed:${tag.replace(/^#/, "")}`;
      const feed = await state.get<Array<Record<string, unknown>>>(key, "json") ?? [];
      await state.put(key, JSON.stringify([{ id: `code:${code}`, type: "code_detected", createdAt: merged.record.firstSeen, message, data: { code, tier: merged.record.tier, sources: merged.record.sources } }, ...feed].slice(0, 50)));
    }
    if (telegramToken && telegramChatId) {
      try {
        await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: telegramChatId, text: `${message}\nRedeem: https://store.supercell.com/clashofclans` }) });
      } catch { /* alerts must never fail the radar */ }
    }
  }
  await state.put("codes:index", JSON.stringify([...known]));
}

export async function listRadarCodes(state: KVNamespace): Promise<RadarCode[]> {
  const index = await state.get<string[]>("codes:index", "json") ?? [];
  const records = await Promise.all(index.map((code) => state.get<RadarCode>(`codes:record:${code}`, "json")));
  return records.filter((record): record is RadarCode => Boolean(record)).sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
}
