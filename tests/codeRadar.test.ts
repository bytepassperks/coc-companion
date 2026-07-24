import { describe, expect, it } from "vitest";
import { codeTier, extractCandidateCodes, formatTelegramAlert, isLikelyCode, mergeRadarCode, scanDiscordMessages, telegramAlertEligible } from "../src/codeRadar";

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

  it("scans Discord content and embeds, and assigns crosspost tiers", () => {
    const found = scanDiscordMessages([
      { id: "1", type: 0, flags: 2, webhook_id: "w", message_reference: { guild_id: "official" }, content: "Redeem code ALEXCALIBUR for a reward." },
      { id: "2", type: 0, content: "Store code ONEMAGICGIFT", embeds: [{ title: "Reward", description: "Claim SHARETHEGOLD" }] },
      { id: "3", type: 7, content: "Redeem BARBARIANCWL" },
      { id: "4", type: 12, content: "Redeem BARBARIANCWL" },
    ], "123");
    expect(found).toEqual([
      { code: "ALEXCALIBUR", source: "discord-official:123" },
      { code: "ONEMAGICGIFT", source: "discord:123" },
      { code: "SHARETHEGOLD", source: "discord:123" },
    ]);
    expect(codeTier({ sources: ["discord-official:123"] })).toBe("official");
    expect(codeTier({ sources: ["discord:123"] })).toBe("reported");
  });

  it("gates Telegram alerts by tier and sends once after a tier upgrade", () => {
    const reported = { code: "ALEXCALIBUR", tier: "reported" as const, sources: ["u7buy"], firstSeen: "2026-07-21T00:00:00.000Z" };
    expect(telegramAlertEligible(undefined, reported)).toBe(false);
    const corroborated = { ...reported, tier: "corroborated" as const, sources: ["u7buy", "buffbuff"] };
    expect(telegramAlertEligible(reported, corroborated)).toBe(true);
    expect(telegramAlertEligible(corroborated, { ...corroborated, telegramAlerted: true })).toBe(false);
  });

  it("escapes Telegram HTML and renders human-readable sources", () => {
    const message = formatTelegramAlert({ code: "ALEX<TEST>", tier: "official", sources: ["official-news", "discord-official:1"], firstSeen: "2026-07-21T00:00:00Z" });
    expect(message).toContain("<code>ALEX&lt;TEST&gt;</code>");
    expect(message).toContain("Supercell news, Official CoC Discord announcement");
    expect(message).toContain("✅ Official");
  });
});
