import type { Ai } from "@cloudflare/workers-types";
import type { Recommendation, Snapshot } from "./types";
import type { AccountAnalysis, NextBestAction } from "./types";

export interface AiUsageStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export const DEFAULT_AI_MODEL = "@cf/meta/llama-3.2-3b-instruct";

export async function summarize(
  ai: Ai | undefined,
  state: Snapshot,
  recommendations: Recommendation[],
  usage: AiUsageStore,
  dailyCap = 8000,
  model = DEFAULT_AI_MODEL,
): Promise<string> {
  return runPrompt(ai, `Summarize this read-only Clash of Clans snapshot for ${state.player.name}: ${JSON.stringify({
    townHallLevel: state.player.townHallLevel,
    trophies: state.player.trophies,
    recommendations,
  })}`, recommendations, usage, dailyCap, model);
}

export async function answerQuestion(
  ai: Ai | undefined,
  question: string,
  state: Snapshot,
  recommendations: Recommendation[],
  usage: AiUsageStore,
  dailyCap = 8000,
  model = DEFAULT_AI_MODEL,
): Promise<string> {
  return runPrompt(ai, `Answer this question using only this read-only Clash of Clans state: ${question}\n${JSON.stringify(compactState(state))}\nRecommendations: ${JSON.stringify(recommendations.slice(0, 10))}`, recommendations, usage, dailyCap, model);
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
): Promise<{ text: string; used: boolean }> {
  const fallback = planFallback(input.actions);
  if (!ai) return { text: fallback, used: false };
  const prompt = JSON.stringify({
    account: {
      name: input.player.name,
      townHallLevel: input.player.townHallLevel,
      warPreference: input.player.warPreference,
    },
    completion: input.analysis.overallCompletion,
    topActions: input.actions.slice(0, 8),
    armySuggestions: input.armySuggestions,
  });
  const date = new Date().toISOString().slice(0, 10);
  const key = `ai_usage:${date}`;
  const used = Number((await usage.get(key)) ?? "0");
  const estimate = Math.max(400, Math.ceil(prompt.length / 4));
  if (used + estimate > dailyCap) return { text: fallback, used: false };
  try {
    const result = await ai.run(model as Parameters<Ai["run"]>[0], {
      messages: [
        {
          role: "system",
          content: "You are a legendary esports-level Clash of Clans strategist and analyst. Be concise and actionable. This is a read-only companion: never suggest automation, credentials, or game-client interaction. Return a headline, a 3-step plan, one war army recommendation, and one-line reasoning for each action.",
        },
        { role: "user", content: prompt },
      ],
    }) as { response?: string; choices?: { message?: { content?: string } }[] };
    const text = result.response ?? result.choices?.[0]?.message?.content;
    if (!text) return { text: fallback, used: false };
    await usage.put(key, String(used + estimate), { expirationTtl: 172800 });
    return { text, used: true };
  } catch {
    return { text: fallback, used: false };
  }
}

async function runPrompt(
  ai: Ai | undefined,
  prompt: string,
  recommendations: Recommendation[],
  usage: AiUsageStore,
  dailyCap: number,
  model: string,
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `ai_usage:${date}`;
  const used = Number((await usage.get(key)) ?? "0");
  const estimate = Math.max(250, Math.ceil(prompt.length / 4));
  if (!ai || used + estimate > dailyCap) return fallback(recommendations);
  const result = await ai.run(model as Parameters<Ai["run"]>[0], {
    messages: [
      { role: "system", content: "You are a concise, read-only Clash of Clans companion. Never instruct automation or game-client interaction." },
      { role: "user", content: prompt },
    ],
  }) as { response?: string; choices?: { message?: { content?: string } }[] };
  await usage.put(key, String(used + estimate), { expirationTtl: 172800 });
  return result.response ?? result.choices?.[0]?.message?.content ?? fallback(recommendations);
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
