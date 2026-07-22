import upgradeConfig from "../config/upgrade-priorities.json";
import notificationConfig from "../config/notifications.json";
import type { KVNamespace } from "@cloudflare/workers-types";
import { CocClient, CocApiError, type CacheLayer } from "./cocClient";
import { answerQuestion, extractAiText, generatePlan, DEFAULT_AI_MODEL, DEFAULT_AI_FALLBACK_MODELS } from "./ai";
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
import { authenticateUser, bearerToken, createSession, destroySession, linkUserTag, registerUser, sessionEmail, unlinkUserTag, type UserRecord } from "./auth";
import { loadCatalog } from "./catalogLoader";
import { buildOcrRoster, groundArmyDraft, groundHeroDraft, OCR_TYPES, ocrPrompt, parseOcrResponse, type OcrRoster, type OcrType } from "./ocr";
import { collectWatched } from "./collector";
import { loadArtifact, predictWar } from "./model";
import { activeTimers, expireTimers, processTimers, timerId, validateTimerInput } from "./timers";
import { calculateRushScore } from "./rushScore";
import { adviseEquipment } from "./equipmentAdvisor";
import { inferBuilderBacklog } from "./builderBacklog";

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
      if (url.pathname === "/api/me" && request.method === "GET") {
        const email = await requireSession(request, env);
        if (!email) return unauthorized(cors);
        const user = await env.STATE.get<UserRecord>(`user:${email}`, "json");
        return json({ email, linkedTags: user?.linkedTags ?? [] }, cors);
      }
      if (url.pathname === "/api/me/tags" && (request.method === "POST" || request.method === "DELETE")) {
        const email = await requireSession(request, env);
        if (!email) return unauthorized(cors);
        const body = await parseJson(request) as { tag?: string } | null;
        if (!body?.tag) throw new ValidationError("tag is required");
        assertTag(body.tag);
        const tag = body.tag.startsWith("#") ? body.tag.toUpperCase() : `#${body.tag.toUpperCase()}`;
        const linkedTags = request.method === "POST"
          ? await linkUserTag(env.STATE, email, tag)
          : await unlinkUserTag(env.STATE, email, tag);
        return json({ email, linkedTags }, cors);
      }
      const ocrMatch = url.pathname.match(/^\/api\/ocr\/([^/]+)$/);
      if (ocrMatch && request.method === "POST") {
        const email = await requireSession(request, env);
        if (!email) return unauthorized(cors);
        const tag = decodeURIComponent(ocrMatch[1]);
        assertTag(tag);
        const contentType = request.headers.get("Content-Type") ?? "";
        let type: string | undefined;
        let debug = false;
        let image: ArrayBuffer;
        let mime = "image/jpeg";
        if (contentType.includes("multipart/form-data")) {
          const form = await request.formData();
          type = String(form.get("type") ?? "");
          debug = String(form.get("debug") ?? "").toLowerCase() === "true";
          const file = form.get("image") ?? form.get("file");
          if (!(file instanceof File)) throw new ValidationError("An image file is required");
          image = await file.arrayBuffer();
          mime = file.type || mime;
        } else {
          const body = await parseJson(request) as { type?: string; image?: string } | null;
          type = body?.type;
          debug = Boolean((body as { debug?: unknown } | null)?.debug);
          if (typeof body?.image !== "string") throw new ValidationError("A base64 image is required");
          const match = body.image.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
          const encoded = match ? match[2] : body.image;
          mime = match?.[1] ?? mime;
          try { image = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)).buffer; } catch { throw new ValidationError("Invalid base64 image"); }
        }
        if (!OCR_TYPES.includes(type as OcrType)) throw new ValidationError("type must be upgrades, builders, army, hero, or ores");
        if (image.byteLength < 1 || image.byteLength > 4 * 1024 * 1024) throw new ValidationError("Image must be between 1 byte and 4MB");
        if (!env.AI) return json({ error: "OCR unavailable: vision AI is not configured" }, cors, 503);
        const imageBase64 = encodeBase64(new Uint8Array(image));
        let roster: OcrRoster | undefined;
        let apiPlayer: Player | undefined;
        if (type === "army" || type === "hero") {
          try {
            const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
            apiPlayer = await client.getPlayer(tag);
            roster = buildOcrRoster(apiPlayer);
          } catch { /* retain best-effort OCR when the public player API is unavailable */ }
        }
        const models = (env.OCR_MODELS || "@cf/meta/llama-4-scout-17b-16e-instruct,@cf/meta/llama-3.2-11b-vision-instruct,@cf/llava-hf/llava-1.5-7b-hf").split(",").map((value) => value.trim()).filter(Boolean);
        let raw: unknown;
        let parseError: unknown;
        const attempts: Array<{ model: string; error: string; raw?: unknown }> = [];
        const loaded = type === "upgrades" ? await loadCatalog(env.STATE) : undefined;
        for (const model of models) {
          try {
            raw = await env.AI.run(model as never, { temperature: 0, max_tokens: type === "army" || type === "hero" ? 1400 : 900, messages: [{ role: "user", content: [{ type: "text", text: ocrPrompt(type as OcrType, roster) }, { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } }] }] } as never);
            if (!raw) continue;
            try {
              let draft = parseOcrResponse(raw, type as OcrType, loaded?.catalog);
              if (type === "army" && apiPlayer) draft = groundArmyDraft(draft, apiPlayer);
              if (type === "hero" && apiPlayer) draft = groundHeroDraft(draft, apiPlayer);
              const response: Record<string, unknown> = { type, draft, reviewed: false };
              if (debug) {
                response.raw = truncateOcrDebug(raw);
                response.attempts = attempts;
              }
              return json(response, cors);
            } catch (error) {
              parseError = error;
              attempts.push({ model, error: error instanceof Error ? error.message : "invalid model output", ...(debug ? { raw: truncateOcrDebug(raw) } : {}) });
            }
          } catch (error) {
            attempts.push({ model, error: error instanceof Error ? error.message : "vision model failed" });
          }
        }
        if (!raw) {
          const unavailable: Record<string, unknown> = { error: "OCR unavailable: no configured vision model could read this image" };
          if (debug) unavailable.attempts = attempts;
          return json(unavailable, cors, 503);
        }
        const response: Record<string, unknown> = { error: `OCR could not produce a safe draft: ${parseError instanceof Error ? parseError.message : "invalid model output"}` };
        if (debug) {
          response.raw = truncateOcrDebug(raw);
          response.attempts = attempts;
        }
        return json(response, cors, 422);
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
      const timerMatch = url.pathname.match(/^\/api\/timers\/([^/]+)$/);
      if (timerMatch && request.method === "GET") {
        const tag = decodeURIComponent(timerMatch[1]);
        assertTag(tag);
        const normalized = tag.replace(/^#/, "");
        const timers = await processTimers(tag, env.STATE);
        return json(activeTimers(timers), cors);
      }
      if (timerMatch && (request.method === "POST" || request.method === "DELETE")) {
        if (!await requireSession(request, env)) return unauthorized(cors);
        const tag = decodeURIComponent(timerMatch[1]);
        assertTag(tag);
        const normalized = tag.replace(/^#/, "");
        const current = await processTimers(tag, env.STATE);
        if (request.method === "DELETE") {
          const body = await parseJson(request) as { id?: string } | null;
          if (!body?.id) throw new ValidationError("Timer id is required");
          const next = current.filter((timer) => timer.id !== body.id);
          await env.STATE.put(`timers:${normalized}`, JSON.stringify(next));
          return json(activeTimers(next), cors);
        }
        if (activeTimers(current).length >= 12) throw new ValidationError("A maximum of 12 active timers is allowed");
        let input;
        try {
          input = validateTimerInput(await parseJson(request));
        } catch (error) {
          throw new ValidationError(error instanceof Error ? error.message : "Invalid timer");
        }
        const next = [...current, { ...input, id: timerId(), startedAt: new Date().toISOString(), notified: false }];
        await env.STATE.put(`timers:${normalized}`, JSON.stringify(next));
        const email = await requireSession(request, env);
        if (email) try { await linkUserTag(env.STATE, email, tag.startsWith("#") ? tag.toUpperCase() : `#${tag.toUpperCase()}`); } catch (_) { /* legacy sessions may have no user record */ }
        return json(activeTimers(next), cors, 201);
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
      const rushMatch = url.pathname.match(/^\/api\/rush\/([^/]+)$/);
      if (rushMatch && request.method === "GET") {
        const tag = decodeURIComponent(rushMatch[1]);
        assertTag(tag);
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
        const player = await client.getPlayer(tag);
        const loaded = await loadCatalog(env.STATE);
        return json({ ...calculateRushScore(player, analyzeAccount(player, loaded.catalog), loaded.catalog), catalogMeta: loaded.meta }, cors);
      }
      const equipmentMatch = url.pathname.match(/^\/api\/equipment\/([^/]+)$/);
      if (equipmentMatch && request.method === "GET") {
        const tag = decodeURIComponent(equipmentMatch[1]);
        assertTag(tag);
        const goal = new URL(request.url).searchParams.get("goal") ?? "balanced";
        if (!["war", "farm", "trophy", "balanced"].includes(goal)) throw new ValidationError("Invalid equipment goal");
        const client = new CocClient({ apiKey: env.COC_API_KEY, baseUrl: env.COC_API_BASE_URL, cache: kvCache(env.STATE) });
        const player = await client.getPlayer(tag);
        const base = await env.STATE.get(`base:${tag.replace(/^#/, "")}`, "json") as BaseState | null;
        const ore = base && (base.oreShiny !== undefined || base.oreGlowy !== undefined || base.oreStarry !== undefined)
          ? { shiny: base.oreShiny, glowy: base.oreGlowy, starry: base.oreStarry }
          : undefined;
        const plan = adviseEquipment(player, goal, ore, base?.heroLineup ?? [], base?.heroLoadouts ?? {});
        return json({ goal, ore, advice: plan.equipment, pets: plan.pets, unknownEquipment: plan.unknownEquipment, provenance: "equipment-meta v1 dated 2026-07-21" }, cors);
      }
      const baseMatch = url.pathname.match(/^\/api\/base\/([^/]+)$/);
      if (baseMatch && (request.method === "GET" || request.method === "POST")) {
        const tag = decodeURIComponent(baseMatch[1]);
        assertTag(tag);
        const key = `base:${tag.replace(/^#/, "")}`;
        if (request.method === "GET") return json((await env.STATE.get(key, "json")) ?? null, cors);
        if (!await requireSession(request, env)) return unauthorized(cors);
        const body = await parseJson(request);
        const loaded = await loadCatalog(env.STATE);
        const base = validateBase(body, loaded.catalog);
        await env.STATE.put(key, JSON.stringify(base));
        const email = await requireSession(request, env);
        if (email) try { await linkUserTag(env.STATE, email, tag.startsWith("#") ? tag.toUpperCase() : `#${tag.toUpperCase()}`); } catch (_) { /* legacy sessions may have no user record */ }
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
        const timers = await processTimers(tag, env.STATE);
        const builderCount = base?.buildersTotal ?? 0;
        const buildersBusy = activeTimers(timers).filter((timer) => timer.kind === "builder").length >= builderCount && builderCount > 0;
        const rankedActions = getNextBestActions(snapshot.player, loaded.catalog, analysis, base ?? undefined, {
          buildersBusy,
          activeLabels: activeTimers(timers).map((timer) => timer.label),
        })
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
          armies: { war: base?.warArmy, home: base?.homeArmy, sameArmy: base?.sameArmy },
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
          timers: activeTimers(timers),
          rushScore: calculateRushScore(snapshot.player, analysis, loaded.catalog),
          equipmentAdvice: adviseEquipment(snapshot.player, base?.goal ?? "balanced", base && (base.oreShiny !== undefined || base.oreGlowy !== undefined || base.oreStarry !== undefined)
            ? { shiny: base.oreShiny, glowy: base.oreGlowy, starry: base.oreStarry }
            : undefined, base?.heroLineup ?? [], base?.heroLoadouts ?? {}),
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
      await processTimers(`#${tag}`, env.STATE);
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

function encodeBase64(value: Uint8Array) {
  let result = "";
  const chunk = 0x8000;
  for (let index = 0; index < value.length; index += chunk) result += String.fromCharCode(...value.subarray(index, index + chunk));
  return btoa(result);
}

function truncateOcrDebug(value: unknown) {
  const text = extractAiText(value) ?? (typeof value === "string" ? value : JSON.stringify(value));
  return text.slice(0, 2000);
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

function validateBase(input: unknown, catalog?: GameCatalog): BaseState {
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
  const oreShiny = number(body.oreShiny, "oreShiny");
  const oreGlowy = number(body.oreGlowy, "oreGlowy");
  const oreStarry = number(body.oreStarry, "oreStarry");
  const wallLevel = body.wallLevel === undefined ? undefined : (() => {
    if (!Number.isInteger(body.wallLevel) || Number(body.wallLevel) < 1 || Number(body.wallLevel) > 18) throw new ValidationError("wallLevel must be an integer from 1 to 18");
    return Number(body.wallLevel);
  })();
  const wallCount = body.wallCount === undefined ? undefined : (() => {
    if (!Number.isInteger(body.wallCount) || Number(body.wallCount) < 0 || Number(body.wallCount) > 350) throw new ValidationError("wallCount must be an integer from 0 to 350");
    return Number(body.wallCount);
  })();
  const magicItemNames = [
    "bookOfHeroes", "bookOfFighting", "bookOfSpells", "bookOfBuilding", "bookOfEverything",
    "hammerOfHeroes", "hammerOfFighting", "hammerOfSpells", "hammerOfBuilding",
    "researchPotion", "builderPotion", "wallRing", "runeGold", "runeElixir", "runeDark",
  ] as const;
  let magicItems: BaseState["magicItems"];
  if (body.magicItems !== undefined) {
    if (!body.magicItems || typeof body.magicItems !== "object") throw new ValidationError("magicItems must be an object");
    magicItems = {};
    for (const name of magicItemNames) {
      const value = (body.magicItems as Record<string, unknown>)[name];
      if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 99)) {
        throw new ValidationError(`${name} must be an integer from 0 to 99`);
      }
      if (value !== undefined) magicItems[name] = Number(value);
    }
  }
  const clanGamesActive = body.clanGamesActive === undefined ? undefined : (() => {
    if (typeof body.clanGamesActive !== "boolean") throw new ValidationError("clanGamesActive must be a boolean");
    return body.clanGamesActive;
  })();
  let builderBacklog: BaseState["builderBacklog"];
  if (body.builderBacklog !== undefined) {
    if (!Array.isArray(body.builderBacklog) || body.builderBacklog.length > 25) throw new ValidationError("builderBacklog must contain up to 25 entries");
    const parsedBacklog = (body.builderBacklog as unknown[]).map((raw) => {
      if (!raw || typeof raw !== "object") throw new ValidationError("Each builder backlog entry must be an object");
      const value = raw as Record<string, unknown>;
      if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 40) throw new ValidationError("Builder backlog names must be 1-40 characters");
      if (!Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 400) throw new ValidationError("Builder backlog count must be an integer from 1 to 400");
      if (typeof value.cost !== "number" || !Number.isFinite(value.cost) || value.cost < 0) throw new ValidationError("Builder backlog cost must be non-negative");
      const name = value.name.trim();
      const cost = Number(value.cost);
      return {
        name,
        count: Number(value.count),
        cost,
        resource: typeof value.resource === "string" && value.resource.trim() ? value.resource.trim() : undefined,
      };
    });
    builderBacklog = catalog ? inferBuilderBacklog(parsedBacklog, catalog) : parsedBacklog;
  }
  let heroLineup: string[] | undefined;
  if (body.heroLineup !== undefined) {
    if (!Array.isArray(body.heroLineup) || body.heroLineup.length > 4 || body.heroLineup.some((name) => typeof name !== "string" || !name.trim())) {
      throw new ValidationError("heroLineup must contain up to 4 hero names");
    }
    heroLineup = [...new Set(body.heroLineup.map((name) => name.trim()))];
  }
  const list = (value: unknown, name: string) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 12 || value.some((item) => typeof item !== "string" || !item.trim())) throw new ValidationError(`${name} must contain up to 12 unit names`);
    return [...new Set(value.map((item) => item.trim()))];
  };
  const warArmy = list(body.warArmy, "warArmy");
  const homeArmy = list(body.homeArmy, "homeArmy");
  const sameArmy = body.sameArmy === undefined ? false : Boolean(body.sameArmy);
  let heroLoadouts: BaseState["heroLoadouts"];
  if (body.heroLoadouts !== undefined) {
    if (!body.heroLoadouts || typeof body.heroLoadouts !== "object") throw new ValidationError("heroLoadouts must be an object");
    heroLoadouts = {};
    for (const [hero, raw] of Object.entries(body.heroLoadouts as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") throw new ValidationError("Each hero loadout must be an object");
      const value = raw as Record<string, unknown>;
      if (!Array.isArray(value.equipment) || value.equipment.length > 2 || value.equipment.some((item) => typeof item !== "string" || !item.trim())) {
        throw new ValidationError("Each hero loadout can contain up to 2 equipment names");
      }
      if (value.pet !== undefined && (typeof value.pet !== "string" || !value.pet.trim())) throw new ValidationError("Loadout pet must be a name");
      heroLoadouts[hero.trim()] = { equipment: [...new Set(value.equipment.map((item) => item.trim()))], pet: value.pet === undefined ? undefined : value.pet.trim() };
    }
  }
  return {
    buildersTotal: number(body.buildersTotal, "buildersTotal"),
    buildersFree: number(body.buildersFree, "buildersFree"),
    labBusy: body.labBusy === undefined ? undefined : Boolean(body.labBusy),
    resources: parsedResources,
    goal: goal as BaseState["goal"],
    oreShiny,
    oreGlowy,
    oreStarry,
    heroLineup,
    warArmy,
    homeArmy: sameArmy ? warArmy : homeArmy,
    sameArmy,
    heroLoadouts,
    wallLevel,
    wallCount,
    magicItems,
    clanGamesActive,
    builderBacklog,
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
