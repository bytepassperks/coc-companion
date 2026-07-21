import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function env() {
  return {
    COC_API_KEY: "test-key",
    STATE: {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockImplementation((key: string) => key.startsWith("session:") ? Promise.resolve({ email: "test@example.com" }) : Promise.resolve(null)),
      list: vi.fn().mockResolvedValue({ keys: [] }),
    },
  };
}

describe("watch routes", () => {
  it("returns 400 for invalid tags and malformed JSON", async () => {
    const testEnv = env();
    const invalidTag = await worker.fetch(new Request("https://example.test/api/player/not-a-tag"), testEnv as never);
    expect(invalidTag.status).toBe(400);
    const ask = await worker.fetch(new Request("https://example.test/api/ask", { method: "POST" }), testEnv as never);
    expect(ask.status).toBe(400);
    const base = await worker.fetch(new Request("https://example.test/api/base/%232PYC", {
      method: "POST", headers: { Authorization: "Bearer test-token" }, body: "{",
    }), testEnv as never);
    expect(base.status).toBe(400);
  });

  it("rejects protected writes without a valid session", async () => {
    const testEnv = env();
    testEnv.STATE.get.mockResolvedValue(null);
    const response = await worker.fetch(new Request("https://example.test/api/watch/%232PYC", { method: "POST" }), testEnv as never);
    expect(response.status).toBe(401);
  });

  it("registers and removes a watched tag", async () => {
    const testEnv = env();
    const register = await worker.fetch(new Request("https://example.test/api/watch/%232PYC", { method: "POST", headers: { Authorization: "Bearer test-token" } }), testEnv as never);
    expect(register.status).toBe(200);
    expect(testEnv.STATE.put).toHaveBeenCalledWith("watch:2PYC", "1");

    const remove = await worker.fetch(new Request("https://example.test/api/watch/%232PYC", { method: "DELETE", headers: { Authorization: "Bearer test-token" } }), testEnv as never);
    expect(remove.status).toBe(200);
    expect(testEnv.STATE.delete).toHaveBeenCalledWith("watch:2PYC");
  });

  it("validates and stores manual base state", async () => {
    const testEnv = env();
    const response = await worker.fetch(new Request("https://example.test/api/base/%232PYC", {
      method: "POST",
      body: JSON.stringify({ buildersTotal: 5, buildersFree: 2, resources: { gold: 10 }, goal: "war" }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    }), testEnv as never);
    expect(response.status).toBe(200);
    expect(testEnv.STATE.put).toHaveBeenCalledWith("base:2PYC", expect.stringContaining('"buildersFree":2'));
    const invalid = await worker.fetch(new Request("https://example.test/api/base/%232PYC", {
      method: "POST", body: JSON.stringify({ buildersFree: -1 }), headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    }), testEnv as never);
    expect(invalid.status).toBe(400);
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
    const body = await response.json() as {
      aiUsed: boolean;
      planText: string;
      actions: unknown[];
      accountDetails?: { categories?: { heroes?: { items?: Array<{ name: string; level: number; thCapLevel: number; apiMaxLevel?: number }> } } };
    };
    expect(response.status).toBe(200);
    expect(body.aiUsed).toBe(false);
    expect(body.planText).toContain("3-step plan");
    expect(body.actions.length).toBeGreaterThan(0);
    expect(body.accountDetails?.categories?.heroes?.items?.[0]).toEqual(expect.objectContaining({
      name: "Barbarian King",
      level: 1,
      thCapLevel: expect.any(Number),
    }));
    vi.unstubAllGlobals();
  });

  it("filters completed action keys from the plan", async () => {
    const testEnv = env();
    testEnv.STATE.get.mockImplementation((key: string) => {
      if (key === "done:2PYC") return Promise.resolve(["hero upgrade:Barbarian King:2"]);
      return Promise.resolve(null);
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag: "#2PYC", name: "Test", townHallLevel: 7, heroes: [{ name: "Barbarian King", level: 1, maxLevel: 110 }], troops: [], spells: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const response = await worker.fetch(new Request("https://example.test/api/plan/%232PYC"), testEnv as never);
    const body = await response.json() as { actions: Array<{ key?: string }> };
    expect(body.actions.every((action) => action.key !== "hero upgrade:Barbarian King:2")).toBe(true);
    vi.unstubAllGlobals();
  });
});
