import upgradeConfig from "../config/upgrade-priorities.json";
import notificationConfig from "../config/notifications.json";
import gameCatalog from "../config/game-data.json";
import type { KVNamespace } from "@cloudflare/workers-types";
import { CocClient, CocApiError, type CacheLayer } from "./cocClient";
import { answerQuestion, generatePlan, DEFAULT_AI_MODEL } from "./ai";
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
        return json(getRecommendations(player, upgradeConfig as unknown as Parameters<typeof getRecommendations>[1]), cors);
      }
      if (url.pathname === "/api/ask" && request.method === "POST") {
        const body = await parseJson(request) as { tag?: string; question?: string } | null;
        if (!body?.tag || !body.question) return json({ error: "tag and question are required" }, cors, 400);
        assertTag(body.tag);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL });
        const tag = body.tag;
        const snapshot = await env.STATE.get(`state:${tag.replace(/^#/, "")}`, "json") as import("./types").Snapshot | null;
        const player = snapshot?.player ?? await client.getPlayer(tag);
        const recommendations = getRecommendations(player, upgradeConfig as unknown as Parameters<typeof getRecommendations>[1]);
        const response = await answerQuestion(env.AI, body.question, snapshot ?? { fetchedAt: new Date().toISOString(), player }, recommendations, env.STATE, Number(env.AI_DAILY_CAP ?? 8000), env.AI_MODEL ?? DEFAULT_AI_MODEL);
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
        const analysis = analyzeAccount(snapshot.player, gameCatalog as unknown as GameCatalog);
        const done = (await env.STATE.get<string[]>(`done:${normalized}`, "json")) ?? [];
        const actions = getNextBestActions(snapshot.player, gameCatalog as unknown as GameCatalog, analysis, base ?? undefined)
          .map((action) => ({ ...action, key: actionKey(action) }))
          .filter((action) => !done.includes(action.key));
        const ai = await generatePlan(env.AI, {
          player: snapshot.player,
          analysis,
          actions,
          armySuggestions: (upgradeConfig as { army_comp_suggestions?: Record<string, string[]> }).army_comp_suggestions?.[`TH${snapshot.player.townHallLevel}`],
        }, env.STATE, Number(env.AI_DAILY_CAP ?? 8000), env.AI_MODEL ?? DEFAULT_AI_MODEL);
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
          },
          completedKeys: done,
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
    for (const key of tags.keys) {
      const tag = key.name.slice("watch:".length);
      if (!tag) continue;
      const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL });
      await collectNotifications(`#${tag}`, client, env.STATE, notificationConfig);
    }
  },
};

function assertTag(tag: string) {
  if (!/^#?[0289PYLQGRJCUV]+$/i.test(tag)) throw new ValidationError("Invalid player tag");
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
  headers.set("Access-Control-Allow-Headers", "Content-Type");
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
