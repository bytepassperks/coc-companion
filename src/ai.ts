import type { Ai } from "@cloudflare/workers-types";
import type { Recommendation, Snapshot } from "./types";
import type { AccountAnalysis, NextBestAction } from "./types";

export interface AiUsageStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export const DEFAULT_AI_MODEL = "@cf/openai/gpt-oss-120b";
export const DEFAULT_AI_FALLBACK_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.2-3b-instruct",
];

export function aiModelChain(primary = DEFAULT_AI_MODEL, configuredFallbacks = DEFAULT_AI_FALLBACK_MODELS) {
  return [...new Set([primary, ...configuredFallbacks.filter(Boolean)])];
}

export function extractAiText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const value = result as {
    response?: unknown;
    output_text?: unknown;
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
    output?: Array<{ content?: Array<{ text?: unknown } | string> | string; text?: unknown }>;
  };
  if (typeof value.response === "string") return value.response;
  if (typeof value.output_text === "string") return value.output_text;
  const choice = value.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;
  if (typeof choice?.text === "string") return choice.text;
  for (const item of value.output ?? []) {
    if (typeof item.text === "string") return item.text;
    if (typeof item.content === "string") return item.content;
    for (const content of item.content ?? []) {
      if (typeof content === "string") return content;
      if (typeof content.text === "string") return content.text;
    }
  }
  return undefined;
}

export interface AiReview {
  verdict: "endorsed" | "adjusted";
  notes: string[];
}

const FALLBACK_REVIEW: AiReview = {
  verdict: "endorsed",
  notes: ["No structured AI objection was available; the deterministic ranking remains the source of truth."],
};

export function parseAiReview(raw: string): AiReview {
  const candidates = [raw];
  const marker = raw.match(/(?:REVIEW_JSON|AI_REVIEW)\s*:\s*(\{[\s\S]*\})/i);
  if (marker) candidates.unshift(marker[1]);
  const object = raw.match(/\{[\s\S]*\}/);
  if (object) candidates.push(object[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { verdict?: unknown; notes?: unknown; review?: { verdict?: unknown; notes?: unknown } };
      if ((parsed.verdict === "endorsed" || parsed.verdict === "adjusted") &&
          Array.isArray(parsed.notes) &&
          parsed.notes.every((note) => typeof note === "string")) {
        return { verdict: parsed.verdict, notes: parsed.notes.slice(0, 8) };
      }
      const review = parsed.review as { verdict?: unknown; notes?: unknown } | undefined;
      if (review && (review.verdict === "endorsed" || review.verdict === "adjusted") &&
          Array.isArray(review.notes) &&
          review.notes.every((note) => typeof note === "string")) {
        return { verdict: review.verdict, notes: review.notes.slice(0, 8) };
      }
    } catch {
      // AI output is untrusted and may not be JSON.
    }
  }
  return FALLBACK_REVIEW;
}

export async function summarize(
  ai: Ai | undefined,
  state: Snapshot,
  recommendations: Recommendation[],
  usage: AiUsageStore,
  dailyCap = 8000,
  model = DEFAULT_AI_MODEL,
  fallbackModels = DEFAULT_AI_FALLBACK_MODELS,
): Promise<string> {
  return runPrompt(ai, `Summarize this read-only Clash of Clans snapshot for ${state.player.name}: ${JSON.stringify({
    townHallLevel: state.player.townHallLevel,
    trophies: state.player.trophies,
    recommendations,
  })}`, recommendations, usage, dailyCap, model, fallbackModels);
}

export async function answerQuestion(
  ai: Ai | undefined,
  question: string,
  state: Snapshot,
  recommendations: Recommendation[],
  usage: AiUsageStore,
  dailyCap = 8000,
  model = DEFAULT_AI_MODEL,
  fallbackModels = DEFAULT_AI_FALLBACK_MODELS,
): Promise<string> {
  return runPrompt(ai, `Answer this question using only this read-only Clash of Clans state: ${question}\n${JSON.stringify(compactState(state))}\nRecommendations: ${JSON.stringify(recommendations.slice(0, 10))}`, recommendations, usage, dailyCap, model, fallbackModels);
}

export async function generatePlan(
  ai: Ai | undefined,
  input: {
    player: Snapshot["player"];
    analysis: AccountAnalysis;
    actions: NextBestAction[];
    armySuggestions: unknown;
  },
  usage: AiUsageStore,
  dailyCap = 8000,
  model = DEFAULT_AI_MODEL,
  fallbackModels = DEFAULT_AI_FALLBACK_MODELS,
): Promise<{ text: string; used: boolean; review: AiReview }> {
  const fallback = planFallback(input.actions);
  if (!ai) return { text: fallback, used: false, review: FALLBACK_REVIEW };
  const prompt = JSON.stringify({
    account: {
      name: input.player.name,
      townHallLevel: input.player.townHallLevel,
      warPreference: input.player.warPreference,
    },
    completion: input.analysis.overallCompletion,
      topActions: input.actions.slice(0, 8).map((action, index) => ({
        rank: index + 1,
        action: action.action,
        subject: action.subject,
        category: action.category,
        score: action.score,
        cost: action.cost,
        resource: action.resource,
        timeSeconds: action.timeSeconds,
      })),
    armySuggestions: input.armySuggestions,
  });
  const date = new Date().toISOString().slice(0, 10);
  const key = `ai_usage:${date}`;
  const used = Number((await usage.get(key)) ?? "0");
  const estimate = Math.max(400, Math.ceil(prompt.length / 4));
  if (used + estimate > dailyCap) return { text: fallback, used: false, review: FALLBACK_REVIEW };
  const system = "You are a panel of four Clash of Clans experts: a legendary pro player, an esports war strategist, a meta/balance specialist, and a game-design analyst. This is a read-only companion: never suggest automation, credentials, or game-client interaction. Review the deterministic ranked action list for this specific account, Town Hall, and goal. Return valid JSON only with {\"plan\":\"...\",\"review\":{\"verdict\":\"endorsed\"|\"adjusted\",\"notes\":[\"one-line reason\"]}}. The review must either endorse the order or identify concrete reordering objections. The deterministic list remains the source of truth.";
  for (const candidate of aiModelChain(model, fallbackModels)) {
    if (used + estimate > dailyCap) break;
    try {
      const result = await runModel(ai, candidate, system, prompt);
      const text = extractAiText(result);
      if (!text) continue;
      await usage.put(key, String(used + estimate), { expirationTtl: 172800 });
      let planText = text;
      try {
        const parsed = JSON.parse(text) as { plan?: unknown };
        if (typeof parsed.plan === "string") planText = parsed.plan;
      } catch {
        // Preserve useful narrative output when the model ignores JSON format.
      }
      return { text: planText, used: true, review: parseAiReview(text) };
    } catch {
      // Try the next configured model.
    }
  }
  return { text: fallback, used: false, review: FALLBACK_REVIEW };
}

async function runPrompt(
  ai: Ai | undefined,
  prompt: string,
  recommendations: Recommendation[],
  usage: AiUsageStore,
  dailyCap: number,
  model: string,
  fallbackModels: string[],
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `ai_usage:${date}`;
  const used = Number((await usage.get(key)) ?? "0");
  const estimate = Math.max(250, Math.ceil(prompt.length / 4));
  if (!ai || used + estimate > dailyCap) return fallback(recommendations);
  for (const candidate of aiModelChain(model, fallbackModels)) {
    if (used + estimate > dailyCap) break;
    try {
      const result = await runModel(ai, candidate, "You are a concise, read-only Clash of Clans companion. Never instruct automation or game-client interaction.", prompt);
      const text = extractAiText(result);
      if (!text) continue;
      await usage.put(key, String(used + estimate), { expirationTtl: 172800 });
      return text;
    } catch {
      // Try the next configured model.
    }
  }
  return fallback(recommendations);
}

async function runModel(ai: Ai, model: string, system: string, prompt: string) {
  try {
    return await ai.run(model as Parameters<Ai["run"]>[0], {
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    });
  } catch (error) {
    if (!model.startsWith("@cf/openai/gpt-oss")) throw error;
    return ai.run(model as Parameters<Ai["run"]>[0], {
      input: prompt,
      instructions: system,
    } as never);
  }
}

function compactState(state: Snapshot) {
  return {
    name: state.player.name,
    townHallLevel: state.player.townHallLevel,
    trophies: state.player.trophies,
    clan: state.player.clan?.name,
    heroes: state.player.heroes?.map((hero) => ({ name: hero.name, level: hero.level, maxLevel: hero.maxLevel })),
    troops: state.player.troops?.map((troop) => ({ name: troop.name, level: troop.level, maxLevel: troop.maxLevel })),
    warState: state.currentWar?.state,
    raidState: state.raidSeasons?.[0]?.state,
  };
}

function fallback(recommendations: Recommendation[]) {
  if (recommendations.length === 0) return "No rules-based recommendations are available for this snapshot.";
  return recommendations
    .slice(0, 8)
    .map((recommendation, index) => `${index + 1}. ${recommendation.subject}: ${recommendation.reason}`)
    .join("\n");
}

function planFallback(actions: NextBestAction[]) {
  if (actions.length === 0) return "No next-best-action data is available yet.";
  const steps = actions.slice(0, 3).map((item, index) =>
    `${index + 1}. ${item.action}${item.targetLevel ? ` to level ${item.targetLevel}` : ""} — ${item.notes[0] ?? "Best rules-based candidate."}`,
  );
  return `Next best action: ${steps[0]}\n\n3-step plan:\n${steps.join("\n")}\n\nWar army: choose the strongest currently unlocked army suggested in the account configuration.`;
}
