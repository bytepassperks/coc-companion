import type { Ai, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  STATE: KVNamespace;
  AI?: Ai;
  COC_API_KEY: string;
  COC_API_BASE_URL?: string;
  AI_DAILY_CAP?: string;
  AI_MODEL?: string;
  AI_FALLBACK_MODELS?: string;
  DATA: R2Bucket;
  MODELS: R2Bucket;
}
