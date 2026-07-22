import { describe, expect, it } from "vitest";
import { extractJsonBlock, extractJsonBlocks, groundArmyDraft, ocrPrompt, parseOcrResponse, snapRosterName } from "../src/ocr";
import type { GameCatalog } from "../src/types";

const catalog = {
  buildings: [{ name: "X-Bow", village: "home", resource: "Gold", levels: [{ level: 11, build_cost: 10000000 }] }],
} as GameCatalog;

describe("screenshot OCR drafts", () => {
  it("recovers balanced JSON from fences and trailing prose", () => {
    expect(extractJsonBlock('Here you go:\n```json\n[{"name":"Dragon","count":1,"level":7}]\n```\nDone.')).toBe('[{"name":"Dragon","count":1,"level":7}]');
    expect(parseOcrResponse('Sure: [{"name":"Dragon","count":1,"level":7}] trailing commentary', "army").entries).toHaveLength(1);
  });

  it("collects adjacent top-level objects and reads response envelopes", () => {
    expect(extractJsonBlocks('{"name":"A","count":1,"cost":2}\n{"name":"B","count":2,"cost":3}')).toHaveLength(2);
    expect(parseOcrResponse('{"name":"A","count":1,"cost":2}\n{"name":"B","count":2,"cost":3}', "upgrades").entries).toHaveLength(2);
    expect(parseOcrResponse({ response: [{ name: "Dragon", count: 1, level: 7 }], tool_calls: [], usage: {} }, "army").entries).toHaveLength(1);
  });

  it("takes the numerator from ore x/y counters", () => {
    expect(parseOcrResponse('{"shiny":"2253/45000","glowy":"273/4500","starry":"369/900"}', "ores")).toMatchObject({ shiny: 2253, glowy: 273, starry: 369 });
    expect(parseOcrResponse('{"shiny":"2253","glowy":"273","starry":"369","magicItems":{"bookOfHeroes":"1"}}', "ores")).toMatchObject({ shiny: 2253, glowy: 273, starry: 369, magicItems: { bookOfHeroes: 1 } });
  });

  it("gives literal builders and army coverage instructions", () => {
    expect(ocrPrompt("builders")).toContain("Upgrade in progress");
    expect(ocrPrompt("builders")).toContain("Earthquake Spell -> level 6");
    expect(ocrPrompt("army")).toContain("EVERY troop, spell, and siege machine");
  });

  it("snaps roster names, flags unmatched names, and trusts API levels", () => {
    expect(snapRosterName("Dragons", ["Dragon"])).toMatchObject({ name: "Dragon", unmatched: false });
    expect(snapRosterName("Gobln", ["Dragon", "Goblin"])).toMatchObject({ name: "Goblin", unmatched: false });
    expect(snapRosterName("Barnaby", ["Dragon", "Goblin"]).unmatched).toBe(true);
    const grounded = groundArmyDraft({ entries: [
      { name: "Dragons", count: 10, level: 1 },
      { name: "Barnaby", count: 1, level: 9 },
    ] }, { troops: [{ name: "Dragon", level: 7 }], spells: [], heroes: [], pets: [], heroEquipment: [] } as never);
    expect(grounded.entries).toEqual([
      { name: "Dragon", count: 10, level: 7 },
      { name: "Barnaby", count: 1, level: 9, unmatched: true },
    ]);
  });

  it("includes the API roster in the army prompt", () => {
    const prompt = ocrPrompt("army", { troops: [{ name: "Dragon", level: 7 }], spells: [], heroes: [], pets: [], equipment: [] });
    expect(prompt).toContain("Dragon");
    expect(prompt).toContain("Every name in your answer MUST be copied");
  });

  it("unwraps common model response wrappers and rejects copied examples", () => {
    expect(parseOcrResponse('{"upgrades":[{"name":"Dragon","count":1,"cost":2}]}', "upgrades").entries).toHaveLength(1);
    expect(parseOcrResponse('{"army":[{"name":"Dragon","count":1,"level":7}]}', "army").entries).toHaveLength(1);
    expect(() => parseOcrResponse('{"shiny":12,"glowy":34,"starry":56}', "ores")).toThrow("repeated the prompt example");
  });

  it("validates typed JSON and wires upgrades through cost inference", () => {
    const result = parseOcrResponse(JSON.stringify([{ name: "X-Bow", count: 1, cost: 8000000 }]), "upgrades", catalog);
    expect((result.entries as Array<{ targetLevel?: number }>)[0].targetLevel).toBe(11);
    expect((result.entries as Array<{ provenance?: string }>)[0].provenance).toContain("discounted");
  });

  it("rejects junk and oversized typed collections", () => {
    expect(() => parseOcrResponse("not json", "ores")).toThrow("invalid JSON");
    expect(() => parseOcrResponse(JSON.stringify([{ name: "x", count: 0, cost: 1 }]), "upgrades")).toThrow("invalid upgrade");
    expect(() => parseOcrResponse(JSON.stringify(Array.from({ length: 26 }, () => ({ name: "x", count: 1, cost: 1 }))), "upgrades")).toThrow("up to 25");
  });

  it("accepts army, hero, builders, and ore schemas", () => {
    expect(parseOcrResponse('[{"name":"Dragon","count":10,"level":7}]', "army").entries).toHaveLength(1);
    expect(parseOcrResponse('[{"hero":"Barbarian King","equipment":["Spiky Ball"],"pet":"Frosty"}]', "hero").entries).toHaveLength(1);
    expect(parseOcrResponse('[{"label":"X-Bow","remaining":"3h 19m","kind":"builder"}]', "builders").entries).toHaveLength(1);
    expect(parseOcrResponse('{"shiny":1088,"glowy":187,"starry":467}', "ores")).toMatchObject({ shiny: 1088, glowy: 187 });
  });
});
