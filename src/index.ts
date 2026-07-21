import upgradeConfig from "../config/upgrade-priorities.json";
import notificationConfig from "../config/notifications.json";
import type { KVNamespace } from "@cloudflare/workers-types";
import { CocClient, CocApiError, type CacheLayer } from "./cocClient";
import { answerQuestion, generatePlan, DEFAULT_AI_MODEL, DEFAULT_AI_FALLBACK_MODELS } from "./ai";
import { collectNotifications } from "./notifications";
import { getRecommendations } from "./recommendationEngine";
import { analyzeAccount } from "./analyzer";
import { getNextBestActions } from "./nextBestAction";
import { analyzeWar } from "./warAnalytics";
import { analyzeClan } from "./clanAnalytics";
import { analyzeCapital } from "./capitalAnalytics";
import type { Env } from "./workerTypes";
import type { BaseState, GameCatalog, Player, Snapshot } from "./types";
import { actionKey } from "./checklist";
import { authenticateUser, bearerToken, createSession, destroySession, registerUser, sessionEmail } from "./auth";
import { loadCatalog } from "./catalogLoader";
import { collectWatched } from "./collector";
import { loadArtifact, predictWar } from "./model";

class ValidationError extends Error {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    try {
      if (request.method === "OPTIONS") return new Response(null, { headers: cors });
      if (url.pathname === "/api/status") return json({ ok: true, service: "coc-companion", readOnly: true }, cors);
      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        const body = await parseJson(request) as { email?: string; password?: string };
        validateCredentials(body?.email, body?.password);
        await registerUser(env.STATE, body?.email!, body?.password!);
        return json({ registered: true, email: body?.email!.trim().toLowerCase() }, cors, 201);
      }
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = await parseJson(request) as { email?: string; password?: string };
        validateCredentials(body?.email, body?.password);
        if (!await authenticateUser(env.STATE, body?.email!, body?.password!)) return json({ error: "Invalid email or password" }, cors, 401);
        return json({ token: await createSession(env.STATE, body?.email!) }, cors);
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const token = bearerToken(request);
        if (!await sessionEmail(env.STATE, token)) return unauthorized(cors);
        await destroySession(env.STATE, token);
        return json({ loggedOut: true }, cors);
      }
      const doneMatch = url.pathname.match(/^\/api\/done\/([^/]+)$/);
      if (doneMatch && request.method === "GET") {
        const tag = decodeURIComponent(doneMatch[1]);
        assertTag(tag);
        return json((await env.STATE.get<string[]>(`done:${tag.replace(/^#/, "")}`, "json")) ?? [], cors);
      }
      if (doneMatch && (request.method === "POST" || request.method === "DELETE")) {
        if (!await requireSession(request, env)) return unauthorized(cors);
        const tag = decodeURIComponent(doneMatch[1]);
        assertTag(tag);
        const normalized = tag.replace(/^#/, "");
        const body = await parseJson(request) as { key?: string } | null;
        if (!body || typeof body.key !== "string" || !body.key) return json({ error: "key is required" }, cors, 400);
        const key = `done:${normalized}`;
        const current = (await env.STATE.get<string[]>(key, "json")) ?? [];
        const next = request.method === "POST"
          ? [...new Set([...current, body.key])]
          : current.filter((item) => item !== body.key);
        await env.STATE.put(key, JSON.stringify(next));
        await env.STATE.delete(`plan:${normalized}`);
        return json(next, cors);
      }
      const skipMatch = url.pathname.match(/^\/api\/skip\/([^/]+)$/);
      if (skipMatch && request.method === "GET") {
        const tag = decodeURIComponent(skipMatch[1]);
        assertTag(tag);
        return json((await env.STATE.get<string[]>(`skip:${tag.replace(/^#/, "")}`, "json")) ?? [], cors);
      }
      if (skipMatch && (request.method === "POST" || request.method === "DELETE")) {
        if (!await requireSession(request, env)) return unauthorized(cors);
        const tag = decodeURIComponent(skipMatch[1]);
        assertTag(tag);
        const normalized = tag.replace(/^#/, "");
        const body = await parseJson(request) as { key?: string } | null;
        if (!body || typeof body.key !== "string" || !body.key) return json({ error: "key is required" }, cors, 400);
        const key = `skip:${normalized}`;
        const current = (await env.STATE.get<string[]>(key, "json")) ?? [];
        const next = request.method === "POST"
          ? [...new Set([...current, body.key])]
          : current.filter((item) => item !== body.key);
        await env.STATE.put(key, JSON.stringify(next));
        await env.STATE.delete(`plan:${normalized}`);
        return json(next, cors);
      }
      const warMatch = url.pathname.match(/^\/api\/war\/([^/]+)$/);
      if (warMatch && request.method === "GET") {
        const clanTag = decodeURIComponent(warMatch[1]);
        assertTag(clanTag);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
        try {
          return json(analyzeWar(await client.getCurrentWar(clanTag), clanTag), cors);
        } catch (error) {
          if (error instanceof CocApiError && (error.code === "accessDenied" || error.code === "invalidIp")) {
            return json({
              state: "unavailable",
              message: "Current war details are unavailable because the clan war endpoint is private or access was denied.",
              provenance: "unavailable",
            }, cors);
          }
          throw error;
        }
      }
      const clanMatch = url.pathname.match(/^\/api\/clan\/([^/]+)$/);
      if (clanMatch && request.method === "GET") {
        const clanTag = decodeURIComponent(clanMatch[1]);
        assertTag(clanTag);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
        const [clan, members] = await Promise.all([client.getClan(clanTag), client.getClanMembers(clanTag)]);
        return json(analyzeClan(clan, members.items), cors);
      }
      const capitalMatch = url.pathname.match(/^\/api\/capital\/([^/]+)$/);
      if (capitalMatch && request.method === "GET") {
        const clanTag = decodeURIComponent(capitalMatch[1]);
        assertTag(clanTag);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
        const seasons = await client.getCapitalRaidSeasons(clanTag);
        return json(analyzeCapital(seasons.items[0]), cors);
      }
      const predictMatch = url.pathname.match(/^\/api\/predict\/war\/([^/]+)$/);
      if (predictMatch && request.method === "GET") {
        const tag = decodeURIComponent(predictMatch[1]);
        assertTag(tag);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
        const player = await client.getPlayer(tag);
        if (!player.clan?.tag) return json({ state: "noClan", message: "This player is not currently in a clan.", predictions: [], modelMeta: { version: "heuristic", mode: "heuristic" } }, cors);
        let war;
        try {
          war = await client.getCurrentWar(player.clan.tag);
        } catch (error) {
          if (error instanceof CocApiError && error.code === "accessDenied") return json({ state: "unavailable", message: "War predictions are unavailable because this war is private.", predictions: [], modelMeta: { version: "heuristic", mode: "heuristic" } }, cors);
          throw error;
        }
        const loadedModel = await loadArtifact(env.MODELS, env.STATE);
        const predictions = predictWar(loadedModel.artifact, player, war);
        return json({
          state: war.state,
          predictions,
          summary: {
            averageTwoStarProbability: predictions.length ? predictions.reduce((sum, item) => sum + item.probability, 0) / predictions.length : 0,
            members: predictions.length,
          },
          modelMeta: { version: loadedModel.version, mode: loadedModel.mode },
        }, cors);
      }
      const benchmarkMatch = url.pathname.match(/^\/api\/benchmark\/([^/]+)$/);
      if (benchmarkMatch && request.method === "GET") {
        const tag = decodeURIComponent(benchmarkMatch[1]);
        assertTag(tag);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
        const player = await client.getPlayer(tag);
        const listed = await env.DATA.list({ prefix: "raw/players/", limit: 100 });
        const values: number[] = [];
        for (const object of listed.objects) {
          const stored = await env.DATA.get(object.key);
          if (!stored) continue;
          try {
            const row = JSON.parse((await stored.text()).split("\n")[0]) as { data?: { trophies?: number } };
            if (typeof row.data?.trophies === "number") values.push(row.data.trophies);
          } catch { /* Ignore malformed historical rows. */ }
        }
        if (values.length < 5) return json({ state: "collecting", message: "Benchmark is collecting public snapshots; more comparable accounts are needed before a percentile is meaningful.", comparable: { trophies: player.trophies, sampleSize: values.length } }, cors);
        const rank = values.filter((value) => value <= (player.trophies ?? 0)).length;
        return json({ state: "ready", sampleSize: values.length, percentiles: { trophies: Math.round(rank / values.length * 100) }, comparable: { trophies: player.trophies, townHallLevel: player.townHallLevel } }, cors);
      }
      const baseMatch = url.pathname.match(/^\/api\/base\/([^/]+)$/);
      if (baseMatch && (request.method === "GET" || request.method === "POST")) {
        const tag = decodeURIComponent(baseMatch[1]);
        assertTag(tag);
        const key = `base:${tag.replace(/^#/, "")}`;
        if (request.method === "GET") return json((await env.STATE.get(key, "json")) ?? null, cors);
        if (!await requireSession(request, env)) return unauthorized(cors);
        const body = await parseJson(request);
        const base = validateBase(body);
        await env.STATE.put(key, JSON.stringify(base));
        await env.STATE.delete(`plan:${tag.replace(/^#/, "")}`);
        return json(base, cors);
      }
      const watchMatch = url.pathname.match(/^\/api\/watch\/([^/]+)$/);
      if (watchMatch && (request.method === "POST" || request.method === "DELETE")) {
        if (!await requireSession(request, env)) return unauthorized(cors);
        const tag = decodeURIComponent(watchMatch[1]);
        assertTag(tag);
        const key = `watch:${tag.replace(/^#/, "")}`;
        if (request.method === "POST") await env.STATE.put(key, "1");
        else await env.STATE.delete(key);
        return json({ watching: request.method === "POST", tag }, cors);
      }
      const match = url.pathname.match(/^\/api\/(player|recommendations|feed)\/([^/]+)$/);
      if (match) {
        const tag = decodeURIComponent(match[2]);
        assertTag(tag);
        if (match[1] === "feed") {
          const feed = await env.STATE.get(`feed:${tag.replace(/^#/, "")}`, "json");
          return json(feed ?? [], cors);
        }
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
        const player = await client.getPlayer(tag);
        if (match[1] === "player") return json(player, cors);
        const loaded = await loadCatalog(env.STATE);
        return json(getRecommendations(player, upgradeConfig as unknown as Parameters<typeof getRecommendations>[1], loaded.catalog), cors);
      }
      if (url.pathname === "/api/ask" && request.method === "POST") {
        const body = await parseJson(request) as { tag?: string; question?: string } | null;
        if (!body?.tag || !body.question) return json({ error: "tag and question are required" }, cors, 400);
        assertTag(body.tag);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL });
        const tag = body.tag;
        const snapshot = await env.STATE.get(`state:${tag.replace(/^#/, "")}`, "json") as import("./types").Snapshot | null;
        const player = snapshot?.player ?? await client.getPlayer(tag);
        const loaded = await loadCatalog(env.STATE);
        const recommendations = getRecommendations(player, upgradeConfig as unknown as Parameters<typeof getRecommendations>[1], loaded.catalog);
        const aiModels = configuredAiModels(env);
        const response = await answerQuestion(env.AI, body.question, snapshot ?? { fetchedAt: new Date().toISOString(), player }, recommendations, env.STATE, Number(env.AI_DAILY_CAP ?? 8000), aiModels[0], aiModels.slice(1));
        return json({ answer: response }, cors);
      }
      const planMatch = url.pathname.match(/^\/api\/plan\/([^/]+)$/);
      if (planMatch && request.method === "GET") {
        const tag = decodeURIComponent(planMatch[1]);
        assertTag(tag);
        const normalized = tag.replace(/^#/, "");
        const cached = await env.STATE.get(`plan:${normalized}`, "json");
        if (cached) return json(cached, cors);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
        const snapshot = await getSnapshot(tag, client, env.STATE);
        const base = await env.STATE.get(`base:${normalized}`, "json") as BaseState | null;
        const loaded = await loadCatalog(env.STATE);
        const analysis = analyzeAccount(snapshot.player, loaded.catalog);
        const done = (await env.STATE.get<string[]>(`done:${normalized}`, "json")) ?? [];
        const skipped = (await env.STATE.get<string[]>(`skip:${normalized}`, "json")) ?? [];
        const rankedActions = getNextBestActions(snapshot.player, loaded.catalog, analysis, base ?? undefined)
          .map((action) => ({ ...action, key: actionKey(action) }))
          .filter((action) => !done.includes(action.key));
        const activeActions = rankedActions.filter((action) => !skipped.includes(action.key));
        const onlySkipped = activeActions.length === 0 && rankedActions.length > 0;
        const actions = [...(onlySkipped ? [] : activeActions), ...(onlySkipped ? rankedActions : rankedActions.filter((action) => skipped.includes(action.key)))]
          .map((action) => onlySkipped && skipped.includes(action.key)
            ? { ...action, notes: [...(action.notes ?? []), "Previously skipped"] }
            : action);
        const ai = await generatePlan(env.AI, {
          player: snapshot.player,
          analysis,
          actions,
          armySuggestions: (upgradeConfig as { army_comp_suggestions?: Record<string, string[]> }).army_comp_suggestions?.[`TH${snapshot.player.townHallLevel}`],
        }, env.STATE, Number(env.AI_DAILY_CAP ?? 8000), configuredAiModels(env)[0], configuredAiModels(env).slice(1));
        const plan = {
          headline: actions[0]?.action ?? "No next-best action yet",
          planText: ai.text,
          actions,
          completion: {
            overall: analysis.overallCompletion,
            categories: Object.fromEntries(Object.entries(analysis.categories).map(([name, value]) => [name, value.completion])),
          },
          accountDetails: {
            categories: analysis.categories,
            achievements: analysis.achievements,
            equipment: snapshot.player.heroEquipment?.length
              ? snapshot.player.heroEquipment
              : snapshot.player.heroes?.flatMap((hero) => hero.equipment ?? []) ?? [],
          },
          catalogMeta: loaded.meta,
          aiReview: ai.review,
          completedKeys: done,
          skippedKeys: skipped,
          generatedAt: new Date().toISOString(),
          aiUsed: ai.used,
        };
        await env.STATE.put(`plan:${normalized}`, JSON.stringify(plan), { expirationTtl: 600 });
        return json(plan, cors);
      }
      return json({ error: "Not found" }, cors, 404);
    } catch (error) {
      if (error instanceof CocApiError) return json({ error: error.message, code: error.code, retryAfterSeconds: error.retryAfterSeconds }, cors, error.status);
      if (error instanceof ValidationError || error instanceof SyntaxError || error instanceof URIError) return json({ error: error.message || "Invalid request" }, cors, 400);
      return json({ error: error instanceof Error ? error.message : "Internal error" }, cors, 500);
    }
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const tags = await env.STATE.list({ prefix: "watch:" });
    const snapshots: Snapshot[] = [];
    const watchedTags: string[] = [];
    for (const key of tags.keys) {
      const tag = key.name.slice("watch:".length);
      if (!tag) continue;
      watchedTags.push(tag);
      const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL });
      const result = await collectNotifications(`#${tag}`, client, env.STATE, notificationConfig);
      snapshots.push(result.snapshot);
    }
    if (env.DATA) {
      const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL });
      await collectWatched(client, env.DATA, env.STATE, watchedTags, snapshots);
    }
  },
};

function assertTag(tag: string) {
  if (!/^#?[0289PYLQGRJCUV]+$/i.test(tag)) throw new ValidationError("Invalid player tag");
}

function configuredAiModels(env: Env) {
  const primary = env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
  const fallback = env.AI_FALLBACK_MODELS
    ? env.AI_FALLBACK_MODELS.split(",").map((model) => model.trim()).filter(Boolean)
    : DEFAULT_AI_FALLBACK_MODELS;
  return [...new Set([primary, ...fallback])];
}

function validateCredentials(email: string | undefined, password: string | undefined) {
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || typeof password !== "string" || password.length < 8) {
    throw new ValidationError("A valid email and password of at least 8 characters are required");
  }
}

async function parseJson(request: Request) {
  try {
    return await request.json() as unknown;
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

async function requireSession(request: Request, env: Env) {
  return sessionEmail(env.STATE, bearerToken(request));
}

function unauthorized(headers: Headers) {
  return json({ error: "Authentication required" }, headers, 401);
}

async function getSnapshot(tag: string, client: CocClient, state: KVNamespace): Promise<Snapshot> {
  const cached = await state.get(`state:${tag.replace(/^#/, "")}`, "json") as Snapshot | null;
  if (cached) return cached;
  const player = await client.getPlayer(tag);
  return { fetchedAt: new Date().toISOString(), player };
}

function validateBase(input: unknown): BaseState {
  if (!input || typeof input !== "object") throw new ValidationError("Base state must be an object");
  const body = input as Record<string, unknown>;
  const number = (value: unknown, name: string) => {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new ValidationError(`${name} must be a non-negative number`);
    return value;
  };
  const goal = body.goal;
  if (goal !== undefined && !["war", "farm", "trophy", "balanced"].includes(String(goal))) throw new ValidationError("Invalid goal");
  const resources = body.resources;
  let parsedResources: BaseState["resources"];
  if (resources !== undefined) {
    if (!resources || typeof resources !== "object") throw new ValidationError("resources must be an object");
    const values = resources as Record<string, unknown>;
    parsedResources = {
      gold: number(values.gold, "gold"),
      elixir: number(values.elixir, "elixir"),
      darkElixir: number(values.darkElixir, "darkElixir"),
    };
  }
  let buildingLevels: Record<string, number[]> | undefined;
  if (body.buildingLevels !== undefined) {
    if (!body.buildingLevels || typeof body.buildingLevels !== "object") throw new ValidationError("buildingLevels must be an object");
    buildingLevels = {};
    for (const [name, levels] of Object.entries(body.buildingLevels as Record<string, unknown>)) {
      if (!Array.isArray(levels) || levels.some((level) => number(level, `${name} level`) === undefined)) throw new ValidationError("buildingLevels values must be arrays of numbers");
      buildingLevels[name] = levels as number[];
    }
  }
  return {
    buildersTotal: number(body.buildersTotal, "buildersTotal"),
    buildersFree: number(body.buildersFree, "buildersFree"),
    labBusy: body.labBusy === undefined ? undefined : Boolean(body.labBusy),
    resources: parsedResources,
    goal: goal as BaseState["goal"],
    buildingLevels,
    updatedAt: new Date().toISOString(),
  };
}

function json(value: unknown, headers: Headers, status = 200) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function corsHeaders(request: Request) {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Vary", "Origin");
  return headers;
}

function kvCache(state: KVNamespace): CacheLayer {
  return {
    get: (key: string) => state.get(`cache:${key}`, "json"),
    put: (key: string, value: unknown, ttlSeconds: number) => state.put(`cache:${key}`, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSeconds) }),
  };
}
