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
});
