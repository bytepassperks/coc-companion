import { describe, expect, it } from "vitest";
import { codeTier, extractCandidateCodes, isLikelyCode, mergeRadarCode } from "../src/codeRadar";

describe("code radar", () => {
  it("extracts contextual codes and rejects ordinary uppercase words", () => {
    const html = "Redeem code FIREANDICE!! for a reward. REGISTER EVERYONE VALENTINE POWERPOINTS BRAWLENTINE.";
    expect(extractCandidateCodes(html, "https://example.com/codes")).toEqual(["FIREANDICE!!"]);
  });

  it("rejects hashes, short random tokens, and other-game candidates", () => {
    for (const code of ["C05FVFNDQVBFM", "N53HQYS1MN", "DAPMSQAT", "BS3Q43IS", "DKZ5D656", "KO2EQAUM", "SV3NUXGI", "LPVIOIFW", "DDYBGURG", "EIV7ROLQ"]) {
      expect(isLikelyCode(code), code).toBe(false);
    }
    expect(isLikelyCode("BRAWLENTINE", "Brawl Stars redeem code")).toBe(false);
    expect(isLikelyCode("ALEXCALIBUR")).toBe(true);
    expect(isLikelyCode("ONEMAGICGIFT")).toBe(true);
    expect(isLikelyCode("SHARETHEGOLD")).toBe(true);
    expect(isLikelyCode("BARBARIANCWL")).toBe(true);
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

  it("keeps user-verified stale codes quiet until an official source reactivates them", () => {
    const stale = { code: "ALEXCALIBUR", tier: "reported" as const, sources: ["u7buy"], firstSeen: "2026-07-01T00:00:00.000Z", alerted: true, stale: true, note: "User-verified not working (Jul 2026)" };
    const community = mergeRadarCode(stale, stale.code, "buffbuff");
    expect(community.record.stale).toBe(true);
    expect(community.record.alerted).toBe(true);
    const official = mergeRadarCode(stale, stale.code, "official-news");
    expect(official.record.stale).toBe(false);
    expect(official.record.alerted).toBe(false);
    expect(official.record.note).toBeUndefined();
  });
});
