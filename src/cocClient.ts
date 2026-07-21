import type {
  Clan,
  ClanMember,
  CurrentWar,
  GoldPassSeason,
  Player,
  RankingsPage,
  RaidSeason,
  WarLogEntry,
} from "./types";

export interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface CocClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxRetries?: number;
  cache?: CacheLayer;
}

export interface CacheLayer {
  get(key: string): Promise<unknown | undefined> | unknown | undefined;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void> | void;
}

export class CocApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: "invalidIp" | "accessDenied" | "notFound" | "rateLimited" | "maintenance" | "serverError" | "unknown",
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "CocApiError";
  }
}

const DEFAULT_BASE_URL = "https://cocproxy.royaleapi.dev/v1";

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function encodeTag(tag: string): string {
  const normalized = tag.startsWith("#") ? tag : `#${tag}`;
  return encodeURIComponent(normalized);
}

export class CocClient {
  private readonly fetcher: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRetries: number;
  private readonly cache?: CacheLayer;
  private readonly baseUrl: string;

  constructor(private readonly options: CocClientOptions) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.maxRetries = options.maxRetries ?? 3;
    this.cache = options.cache;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  getPlayer(tag: string) {
    return this.get<Player>(`/players/${encodeTag(tag)}`);
  }

  getClan(tag: string) {
    return this.get<Clan>(`/clans/${encodeTag(tag)}`);
  }

  getCurrentWar(clanTag: string) {
    return this.get<CurrentWar>(`/clans/${encodeTag(clanTag)}/currentwar`);
  }

  getWarLog(clanTag: string) {
    return this.get<ApiList<WarLogEntry>>(`/clans/${encodeTag(clanTag)}/warlog`);
  }

  getCapitalRaidSeasons(clanTag: string) {
    return this.get<ApiList<RaidSeason>>(`/clans/${encodeTag(clanTag)}/capitalraidseasons`);
  }

  getLocationRankings(location = "global") {
    return this.get<RankingsPage>(`/locations/${encodeURIComponent(location)}/rankings/players`);
  }

  getGoldPassSeason() {
    return this.get<GoldPassSeason>("/goldpass/seasons/current");
  }

  getClanMembers(clanTag: string) {
    return this.get<ApiList<ClanMember>>(`/clans/${encodeTag(clanTag)}/members`);
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const cached = await this.cache?.get(url);
    if (cached !== undefined && cached !== null) return cached as T;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.fetcher(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
      });
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
      if (response.ok) {
        const data = (await response.json()) as T;
        const maxAge = parseMaxAge(response.headers.get("Cache-Control"));
        if (maxAge > 0) await this.cache?.put(url, data, maxAge);
        return data;
      }

      const error = await this.toError(response, retryAfter);
      const retryable = error.code === "rateLimited" || error.code === "serverError" || error.code === "maintenance";
      if (!retryable || attempt >= this.maxRetries) throw error;

      const exponential = Math.min(10_000, 250 * 2 ** attempt);
      const retryDelay = retryAfter !== undefined ? retryAfter * 1000 : exponential;
      const jitter = Math.floor(this.random() * Math.min(250, retryDelay * 0.25));
      await this.sleep(retryDelay + jitter);
    }
    throw new CocApiError("Request retries exhausted", 500, "serverError");
  }

  private async toError(response: Response, retryAfter?: number) {
    let body: { reason?: string; message?: string } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Preserve a useful typed error even when the API returns non-JSON.
    }
    if (response.status === 403) {
      const code = body.reason === "accessDenied.invalidIp" ? "invalidIp" : "accessDenied";
      return new CocApiError(body.reason ?? "Access denied", 403, code);
    }
    if (response.status === 404) return new CocApiError(body.reason ?? "Not found", 404, "notFound");
    if (response.status === 429) return new CocApiError(body.reason ?? "Rate limited", 429, "rateLimited", retryAfter);
    if (response.status === 503) return new CocApiError(body.reason ?? "Maintenance", 503, "maintenance", retryAfter);
    if (response.status >= 500) return new CocApiError(body.message ?? "Server error", response.status, "serverError", retryAfter);
    return new CocApiError(body.message ?? "Clash API request failed", response.status, "unknown");
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function parseMaxAge(value: string | null): number {
  const match = value?.match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Number(match[1]) : 0;
}

interface ApiList<T> {
  items: T[];
  paging?: { cursors?: { after?: string } };
}
