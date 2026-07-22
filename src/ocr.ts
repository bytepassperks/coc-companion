import { extractAiText } from "./ai";
import type { GameCatalog } from "./types";
import { inferBuilderBacklog } from "./builderBacklog";

export const OCR_TYPES = ["upgrades", "builders", "army", "hero", "ores"] as const;
export type OcrType = typeof OCR_TYPES[number];
export type OcrDraft = Record<string, unknown>;

const names = (value: unknown, max = 40) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const integer = (value: unknown, min = 0, max = 400) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

export function parseOcrResponse(raw: unknown, type: OcrType, catalog?: GameCatalog): OcrDraft {
  const text = typeof raw === "string" ? raw : extractAiText(raw);
  if (!text) throw new Error("OCR returned no structured data");
  const candidates = [text, text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? "", text.match(/\{[\s\S]*\}/)?.[0] ?? "", text.match(/\[[\s\S]*\]/)?.[0] ?? ""];
  let parsed: unknown;
  for (const candidate of candidates) {
    try { if (candidate.trim()) { parsed = JSON.parse(candidate); break; } } catch { /* untrusted model output */ }
  }
  if (parsed === undefined) throw new Error("OCR returned invalid JSON");
  if (type === "upgrades") {
    if (!Array.isArray(parsed) || parsed.length > 25) throw new Error("OCR upgrades must be an array of up to 25 entries");
    const entries = parsed.map((item) => {
      const value = item as Record<string, unknown>;
      if (!value || !names(value.name) || !integer(value.count, 1, 400) || typeof value.cost !== "number" || !Number.isFinite(value.cost) || value.cost < 0) throw new Error("OCR returned an invalid upgrade entry");
      return { name: (value.name as string).trim(), count: value.count as number, cost: value.cost as number, ...(typeof value.resource === "string" ? { resource: value.resource.trim() } : {}) };
    });
    return { entries: catalog ? inferBuilderBacklog(entries, catalog) : entries };
  }
  if (type === "builders") {
    if (!Array.isArray(parsed) || parsed.length > 12) throw new Error("OCR builders must be an array of up to 12 entries");
    return { entries: parsed.map((item) => {
      const value = item as Record<string, unknown>;
      if (!value || !names(value.label, 60) || !names(value.remaining, 30) || (value.kind !== undefined && !["builder", "lab", "pet", "hero", "other"].includes(String(value.kind)))) throw new Error("OCR returned an invalid builder entry");
      return { label: (value.label as string).trim(), remaining: (value.remaining as string).trim(), kind: value.kind ?? "builder" };
    }) };
  }
  if (type === "army") {
    if (!Array.isArray(parsed) || parsed.length > 24) throw new Error("OCR army must be an array of up to 24 entries");
    return { entries: parsed.map((item) => {
      const value = item as Record<string, unknown>;
      if (!value || !names(value.name) || !integer(value.count, 0, 400) || !integer(value.level, 0, 100)) throw new Error("OCR returned an invalid army entry");
      return { name: (value.name as string).trim(), count: value.count as number, level: value.level as number };
    }) };
  }
  if (type === "hero") {
    if (!Array.isArray(parsed)) parsed = [parsed];
    if ((parsed as unknown[]).length > 8) throw new Error("OCR hero data contains too many heroes");
    return { entries: (parsed as unknown[]).map((item) => {
      const value = item as Record<string, unknown>;
      if (!value || !names(value.hero, 40) || !Array.isArray(value.equipment) || value.equipment.length > 2 || !value.equipment.every((name) => names(name, 60)) || (value.pet !== undefined && !names(value.pet, 60))) throw new Error("OCR returned invalid hero data");
      return { hero: (value.hero as string).trim(), equipment: (value.equipment as string[]).map((name) => name.trim()), ...(value.pet ? { pet: (value.pet as string).trim() } : {}) };
    }) };
  }
  if (!parsed || typeof parsed !== "object" || !integer((parsed as Record<string, unknown>).shiny, 0, 1000000) || !integer((parsed as Record<string, unknown>).glowy, 0, 1000000) || !integer((parsed as Record<string, unknown>).starry, 0, 1000000)) throw new Error("OCR returned invalid ore balances");
  const value = parsed as Record<string, unknown>;
  return { shiny: value.shiny, glowy: value.glowy, starry: value.starry, ...(value.magicItems && typeof value.magicItems === "object" ? { magicItems: value.magicItems } : {}) };
}

export function ocrPrompt(type: OcrType) {
  const schemas: Record<OcrType, string> = {
    upgrades: '[{"name":"X-Bow","count":1,"cost":8000000,"resource":"Gold"}]',
    builders: '[{"label":"Archer Tower","remaining":"3h 19m","kind":"builder"}]',
    army: '[{"name":"Dragon","count":10,"level":7}]',
    hero: '[{"hero":"Barbarian King","equipment":["Spiky Ball","Snake Bracelet"],"pet":"Frosty"}]',
    ores: '{"shiny":1088,"glowy":187,"starry":467,"magicItems":{"bookOfHeroes":1}}',
  };
  return `Read this Clash of Clans screenshot. Return ONLY valid JSON matching this schema, never markdown. If a value is unreadable, omit that entry rather than guessing. Schema: ${schemas[type]}`;
}
