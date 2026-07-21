import { describe, expect, it, vi } from "vitest";
import { evaluateArtifact, heuristicProbability, loadArtifact, predictWar, validateArtifact } from "../src/model";

const linear = {
  version: 1 as const,
  trainedAt: "2026-07-21T00:00:00Z",
  features: ["thDiff"],
  type: "linear" as const,
  weights: [1],
  bias: 0,
  metrics: { accuracy: 0.5 },
  minSamples: 1,
};

describe("model artifacts", () => {
  it("accepts valid linear artifacts and rejects invalid numeric schema", () => {
    expect(validateArtifact(linear)).toBe(true);
    expect(validateArtifact({ ...linear, weights: [Number.NaN] })).toBe(false);
    expect(validateArtifact({ ...linear, version: 2 })).toBe(false);
  });

  it("evaluates linear and handcrafted GBDT artifacts", () => {
    expect(evaluateArtifact(linear, { thDiff: 0 })).toBeCloseTo(0.5);
    const tree = {
      ...linear,
      type: "gbdt" as const,
      weights: undefined,
      trees: [{ nodes: [{ feature: 0, threshold: 0, left: 1, right: 2 }, { value: -2 }, { value: 2 }] }],
    };
    expect(evaluateArtifact(tree, { thDiff: -1 })).toBeLessThan(0.2);
    expect(evaluateArtifact(tree, { thDiff: 1 })).toBeGreaterThan(0.8);
  });

  it("provides a deterministic heuristic fallback", () => {
    expect(heuristicProbability({ townHallLevel: 16, heroes: [{ level: 90 }] }, { townhallLevel: 15 })).toBeGreaterThan(.5);
  });

  it("normalizes star probabilities to a distribution", () => {
    const war = {
      state: "inWar",
      clan: { members: [{ tag: "#A", townHallLevel: 10, mapPosition: 1 }] },
      opponent: { members: [{ tag: "#D", townHallLevel: 10, mapPosition: 1 }] },
    } as never;
    const result = predictWar(undefined, { tag: "#A", name: "A", townHallLevel: 10 }, war)[0];
    expect(Object.values(result.starProbabilities).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it("falls back when the R2 pointer or artifact is invalid", async () => {
    const models = { get: vi.fn().mockResolvedValue(null) };
    const state = { get: vi.fn().mockResolvedValue(null), put: vi.fn() };
    await expect(loadArtifact(models as never, state as never)).resolves.toEqual({ mode: "heuristic", version: "heuristic" });
  });
});
