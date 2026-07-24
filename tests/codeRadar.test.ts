import { describe, expect, it } from "vitest";
import { codeTier, extractCandidateCodes, mergeRadarCode } from "../src/codeRadar";

describe("code radar", () => {
  it("extracts contextual codes and rejects ordinary uppercase words", () => {
    const html = "Redeem code FIREANDICE!! for a reward. SUPERCELL CLASHOFCLANS REDEEMCODE.";
    expect(extractCandidateCodes(html, "https://example.com/codes")).toEqual(["FIREANDICE!!"]);
  });

  it("assigns official and corroborated tiers", () => {
    expect(codeTier({ sources: ["official-news"] })).toBe("official");
    expect(codeTier({ sources: ["u7buy", "buffbuff"] })).toBe("corroborated");
    expect(codeTier({ sources: ["u7buy"] })).toBe("reported");
  });

  it("alerts only when a code is first seen", () => {
    const first = mergeRadarCode(undefined, "TESTCODE", "u7buy", "2026-07-21T00:00:00.000Z");
    const second = mergeRadarCode(first.record, "TESTCODE", "buffbuff", "2026-07-21T01:00:00.000Z");
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.record.sources).toEqual(["u7buy", "buffbuff"]);
    expect(second.record.tier).toBe("corroborated");
  });
});
