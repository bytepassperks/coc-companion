import upgradeConfig from "../config/upgrade-priorities.json";
import notificationConfig from "../config/notifications.json";
import type { KVNamespace } from "@cloudflare/workers-types";
import { CocClient, CocApiError, type CacheLayer } from "./cocClient";
import { answerQuestion, DEFAULT_AI_MODEL } from "./ai";
import { collectNotifications } from "./notifications";
import { getRecommendations } from "./recommendationEngine";
import type { Env } from "./workerTypes";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    try {
      if (request.method === "OPTIONS") return new Response(null, { headers: cors });
      if (url.pathname === "/api/status") return json({ ok: true, service: "coc-companion", readOnly: true }, cors);
      const watchMatch = url.pathname.match(/^\/api\/watch\/([^/]+)$/);
      if (watchMatch && (request.method === "POST" || request.method === "DELETE")) {
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
        const body = await request.json() as { tag?: string; question?: string };
        if (!body.tag || !body.question) return json({ error: "tag and question are required" }, cors, 400);
        assertTag(body.tag);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL });
        const tag = body.tag;
        const snapshot = await env.STATE.get(`state:${tag.replace(/^#/, "")}`, "json") as import("./types").Snapshot | null;
        const player = snapshot?.player ?? await client.getPlayer(tag);
        const recommendations = getRecommendations(player, upgradeConfig as unknown as Parameters<typeof getRecommendations>[1]);
        const response = await answerQuestion(env.AI, body.question, snapshot ?? { fetchedAt: new Date().toISOString(), player }, recommendations, env.STATE, Number(env.AI_DAILY_CAP ?? 8000), env.AI_MODEL ?? DEFAULT_AI_MODEL);
        return json({ answer: response }, cors);
      }
      return json({ error: "Not found" }, cors, 404);
    } catch (error) {
      if (error instanceof CocApiError) return json({ error: error.message, code: error.code, retryAfterSeconds: error.retryAfterSeconds }, cors, error.status);
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
  if (!/^#?[0289PYLQGRJCUV]+$/i.test(tag)) throw new Error("Invalid player tag");
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
