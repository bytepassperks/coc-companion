import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function env() {
  return {
    COC_API_KEY: "test-key",
    STATE: {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({ keys: [] }),
    },
  };
}

describe("watch routes", () => {
  it("registers and removes a watched tag", async () => {
    const testEnv = env();
    const register = await worker.fetch(new Request("https://example.test/api/watch/%232PYC", { method: "POST" }), testEnv as never);
    expect(register.status).toBe(200);
    expect(testEnv.STATE.put).toHaveBeenCalledWith("watch:2PYC", "1");

    const remove = await worker.fetch(new Request("https://example.test/api/watch/%232PYC", { method: "DELETE" }), testEnv as never);
    expect(remove.status).toBe(200);
    expect(testEnv.STATE.delete).toHaveBeenCalledWith("watch:2PYC");
  });

  it("validates and stores manual base state", async () => {
    const testEnv = env();
    const response = await worker.fetch(new Request("https://example.test/api/base/%232PYC", {
      method: "POST",
      body: JSON.stringify({ buildersTotal: 5, buildersFree: 2, resources: { gold: 10 }, goal: "war" }),
      headers: { "Content-Type": "application/json" },
    }), testEnv as never);
    expect(response.status).toBe(200);
    expect(testEnv.STATE.put).toHaveBeenCalledWith("base:2PYC", expect.stringContaining('"buildersFree":2'));
    const invalid = await worker.fetch(new Request("https://example.test/api/base/%232PYC", {
      method: "POST", body: JSON.stringify({ buildersFree: -1 }), headers: { "Content-Type": "application/json" },
    }), testEnv as never);
    expect(invalid.status).toBe(500);
  });

  it("returns a rules-only plan when Workers AI is absent", async () => {
    const testEnv = env();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag: "#2PYC", name: "Test", townHallLevel: 7, warPreference: "in",
      heroes: [{ name: "Barbarian King", level: 1, maxLevel: 110 }],
      troops: [{ name: "Barbarian", level: 1, maxLevel: 13, village: "home" }],
      spells: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const response = await worker.fetch(new Request("https://example.test/api/plan/%232PYC"), testEnv as never);
    const body = await response.json() as { aiUsed: boolean; planText: string; actions: unknown[] };
    expect(response.status).toBe(200);
    expect(body.aiUsed).toBe(false);
    expect(body.planText).toContain("3-step plan");
    expect(body.actions.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});
