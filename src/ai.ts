import type { Ai } from "@cloudflare/workers-types";
import type { Recommendation, Snapshot } from "./types";

export interface AiUsageStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export async function summarize(
  ai: Ai | undefined,
  state: Snapshot,
  recommendations: Recommendation[],
  usage: AiUsageStore,
  dailyCap = 8000,
): Promise<string> {
  return runPrompt(ai, `Summarize this read-only Clash of Clans snapshot for ${state.player.name}: ${JSON.stringify({
    townHallLevel: state.player.townHallLevel,
    trophies: state.player.trophies,
    recommendations,
  })}`, recommendations, usage, dailyCap);
}

export async function answerQuestion(
  ai: Ai | undefined,
  question: string,
  state: Snapshot,
  recommendations: Recommendation[],
  usage: AiUsageStore,
  dailyCap = 8000,
): Promise<string> {
  return runPrompt(ai, `Answer this question using only this read-only Clash of Clans state: ${question}\n${JSON.stringify(state)}\nRecommendations: ${JSON.stringify(recommendations)}`, recommendations, usage, dailyCap);
}

async function runPrompt(
  ai: Ai | undefined,
  prompt: string,
  recommendations: Recommendation[],
  usage: AiUsageStore,
  dailyCap: number,
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `ai_usage:${date}`;
  const used = Number((await usage.get(key)) ?? "0");
  const estimate = Math.max(250, Math.ceil(prompt.length / 4));
  if (!ai || used + estimate > dailyCap) return fallback(recommendations);
  const result = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: "You are a concise, read-only Clash of Clans companion. Never instruct automation or game-client interaction." },
      { role: "user", content: prompt },
    ],
  }) as { response?: string };
  await usage.put(key, String(used + estimate), { expirationTtl: 172800 });
  return result.response ?? fallback(recommendations);
}

function fallback(recommendations: Recommendation[]) {
  if (recommendations.length === 0) return "No rules-based recommendations are available for this snapshot.";
  return recommendations
    .slice(0, 8)
    .map((recommendation, index) => `${index + 1}. ${recommendation.subject}: ${recommendation.reason}`)
    .join("\n");
}
