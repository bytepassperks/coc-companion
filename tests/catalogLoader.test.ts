import { describe, expect, it, vi } from "vitest";
import { loadCatalog } from "../src/catalogLoader";

function state() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

describe("catalog loader", () => {
  it("falls back to the bundled catalog when the live source fails", async () => {
    const kv = state();
    const loaded = await loadCatalog(kv as never, vi.fn().mockRejectedValue(new Error("offline")));
    expect(loaded.meta.mode).toBe("bundled");
    expect(loaded.catalog.heroes.length).toBeGreaterThan(0);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("prefers cached trimmed catalog before live fetch", async () => {
    const kv = state();
    kv.get.mockResolvedValue({ catalog: { metadata: { source: "live", accessed: "2026-07-21" }, heroes: [], troops: [], spells: [], buildings: [], traps: [] }, fetchedAt: "2026-07-22T00:00:00.000Z" });
    const fetcher = vi.fn();
    const loaded = await loadCatalog(kv as never, fetcher);
    expect(loaded.meta.mode).toBe("cached");
    expect(loaded.meta.fetchedAt).toBe("2026-07-22T00:00:00.000Z");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
