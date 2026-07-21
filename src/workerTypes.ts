import type { Ai, KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  STATE: KVNamespace;
  AI: Ai;
  COC_API_KEY: string;
  COC_API_BASE_URL?: string;
  AI_DAILY_CAP?: string;
  AI_MODEL?: string;
}
