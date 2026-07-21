import bundledCatalog from "../config/game-data.json";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { GameCatalog } from "./types";
// The same plain ESM trim module is imported by the Node catalog-generation script.
// @ts-expect-error TypeScript does not resolve declarations for a .mjs sibling.
import { CATALOG_SOURCE, trimCatalog } from "./catalogTrim.mjs";

export interface CatalogMeta {
  source: string;
  fetchedAt: string;
  mode: "live" | "cached" | "bundled";
}

export interface LoadedCatalog {
  catalog: GameCatalog;
  meta: CatalogMeta;
}

interface CatalogCache {
  catalog: GameCatalog;
  fetchedAt: string;
}

const LIVE_TIMEOUT_MS = 10_000;

export async function loadCatalog(state: KVNamespace, fetcher: typeof fetch = fetch): Promise<LoadedCatalog> {
  const cached = await state.get<CatalogCache>("catalog:v1", "json");
  if (cached?.catalog) {
    return {
      catalog: cached.catalog,
      meta: { source: cached.catalog.metadata.source, fetchedAt: cached.fetchedAt, mode: "cached" },
    };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
    try {
      const response = await fetcher(CATALOG_SOURCE, { signal: controller.signal });
      if (!response.ok) throw new Error(`Catalog fetch failed: ${response.status}`);
      const raw = await response.json() as { heroes?: unknown; troops?: unknown; spells?: unknown };
      if (!Array.isArray(raw.heroes) || !Array.isArray(raw.troops) || !Array.isArray(raw.spells)) throw new Error("Catalog payload is invalid");
      const trimmed = trimCatalog(raw);
      const fetchedAt = new Date().toISOString();
      await state.put("catalog:v1", JSON.stringify({ catalog: trimmed, fetchedAt }), { expirationTtl: 86_400 });
      return { catalog: trimmed, meta: { source: CATALOG_SOURCE, fetchedAt, mode: "live" } };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    const catalog = bundledCatalog as unknown as GameCatalog;
    return {
      catalog,
      meta: { source: catalog.metadata.source, fetchedAt: catalog.metadata.accessed, mode: "bundled" },
    };
  }
}
