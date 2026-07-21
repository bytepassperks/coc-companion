import { describe, expect, it, vi } from "vitest";
import { generatePlan } from "../src/ai";

describe("plan AI fallback", () => {
  it("returns rules text when AI is absent", async () => {
    const result = await generatePlan(undefined, {
      player: { name: "Test", tag: "#2PYC", townHallLevel: 7 },
      analysis: {} as never,
      actions: [{
        action: "Upgrade King", category: "hero upgrade", subject: "King", score: 1,
        confidence: "community_consensus", provenance: "calculated", notes: [],
      }],
      armySuggestions: [],
    }, { get: vi.fn().mockResolvedValue(null), put: vi.fn() });
    expect(result.used).toBe(false);
    expect(result.text).toContain("Upgrade King");
  });
});
