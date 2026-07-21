import { describe, expect, it, vi } from "vitest";
import { extractAiText, generatePlan, parseAiReview } from "../src/ai";

describe("plan AI fallback", () => {
  it("returns rules text when AI is absent", async () => {
    const result = await generatePlan(undefined, {
      player: { name: "Test", tag: "#2PYC", townHallLevel: 7 },
      analysis: {} as never,
      actions: [{
        action: "Upgrade King", category: "hero upgrade", subject: "King", score: 1,
        confidence: "community_consensus", provenance: "calculated", notes: [], why: "A test action.",
      }],
      armySuggestions: [],
    }, { get: vi.fn().mockResolvedValue(null), put: vi.fn() });
    expect(result.used).toBe(false);
    expect(result.text).toContain("Upgrade King");
  });
});

describe("AI review parsing", () => {
  it("parses a structured review", () => {
    expect(parseAiReview('{"verdict":"adjusted","notes":["Move the lab action ahead of walls."]}')).toEqual({
      verdict: "adjusted",
      notes: ["Move the lab action ahead of walls."],
    });
  });

  it("falls back safely for malformed output", () => {
    expect(parseAiReview("The panel recommends the deterministic order.")).toEqual(expect.objectContaining({
      verdict: "endorsed",
      notes: expect.any(Array),
    }));
  });
});

describe("AI model fallback chain", () => {
  it("tries the next model after a per-model error", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("primary unavailable"))
      .mockResolvedValueOnce({ output_text: JSON.stringify({ plan: "Fallback plan", review: { verdict: "endorsed", notes: ["Stable."] } }) });
    const result = await generatePlan({ run } as never, {
      player: { name: "Test", tag: "#2PYC", townHallLevel: 7 },
      analysis: {} as never,
      actions: [{ action: "Upgrade King", category: "hero upgrade", subject: "King", score: 1, confidence: "community_consensus", provenance: "calculated", notes: [], why: "A test action.", cost: 10 }],
      armySuggestions: [],
    }, { get: vi.fn().mockResolvedValue(null), put: vi.fn() }, 8000, "primary-model", ["fallback-model"]);
    expect(result.used).toBe(true);
    expect(result.text).toBe("Fallback plan");
    expect(run.mock.calls.map(call => call[0])).toEqual(["primary-model", "fallback-model"]);
  });

  it("extracts supported Workers AI response shapes", () => {
    expect(extractAiText({ response: "a" })).toBe("a");
    expect(extractAiText({ choices: [{ message: { content: "b" } }] })).toBe("b");
    expect(extractAiText({ output_text: "c" })).toBe("c");
    expect(extractAiText({ output: [{ content: [{ text: "d" }] }] })).toBe("d");
  });
});
