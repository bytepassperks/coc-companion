import { extractAiText } from "./ai";
import type { GameCatalog } from "./types";
import { inferBuilderBacklog } from "./builderBacklog";

export const OCR_TYPES = ["upgrades", "builders", "army", "hero", "ores"] as const;
export type OcrType = typeof OCR_TYPES[number];
export type OcrDraft = Record<string, unknown>;

export function extractJsonBlock(text: string) {
  const unfenced = text.replace(/```(?:json)?/gi, "").replace(/```/g, "");
  for (let start = 0; start < unfenced.length; start += 1) {
    if (unfenced[start] !== "[" && unfenced[start] !== "{") continue;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < unfenced.length; index += 1) {
      const character = unfenced[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") quoted = false;
        continue;
      }
      if (character === "\"") { quoted = true; continue; }
      if (character === "[" || character === "{") stack.push(character);
      else if (character === "]" || character === "}") {
        const opener = stack.pop();
        if ((character === "]" && opener !== "[") || (character === "}" && opener !== "{")) break;
        if (!stack.length) return unfenced.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

const names = (value: unknown, max = 40) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const integer = (value: unknown, min = 0, max = 400) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

export function parseOcrResponse(raw: unknown, type: OcrType, catalog?: GameCatalog): OcrDraft {
  const text = typeof raw === "string" ? raw : extractAiText(raw);
  if (!text) throw new Error("OCR returned no structured data");
  const candidates = [extractJsonBlock(text), text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim()].filter((candidate): candidate is string => Boolean(candidate));
  let parsed: unknown;
  for (const candidate of candidates) {
    try { if (candidate.trim()) { parsed = JSON.parse(candidate); break; } } catch { /* untrusted model output */ }
  }
  if (parsed === undefined) throw new Error("OCR returned invalid JSON");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const properties = Object.values(parsed as Record<string, unknown>);
    if (properties.length === 1 && Array.isArray(properties[0])) parsed = properties[0];
    else if (type === "ores" && properties.length === 1 && properties[0] && typeof properties[0] === "object") parsed = properties[0];
  }
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
  if (value.shiny === 12 && value.glowy === 34 && value.starry === 56) throw new Error("OCR repeated the prompt example instead of reading the image");
  return { shiny: value.shiny, glowy: value.glowy, starry: value.starry, ...(value.magicItems && typeof value.magicItems === "object" ? { magicItems: value.magicItems } : {}) };
}

export function ocrPrompt(type: OcrType) {
  const schemas: Record<OcrType, string> = {
    upgrades: '[{"name":"Example Tower","count":2,"cost":123456,"resource":"Gold"}]',
    builders: '[{"label":"Example Builder","remaining":"1h 2m","kind":"builder"}]',
    army: '[{"name":"Example Troop","count":3,"level":4}]',
    hero: '[{"hero":"Example Hero","equipment":["Example Equipment"],"pet":"Example Pet"}]',
    ores: '{"shiny":12,"glowy":34,"starry":56,"magicItems":{"bookOfHeroes":2}}',
  };
  return `Read this mobile Clash of Clans game screenshot and list every visible row. Respond with ONLY minified JSON, with no markdown, prose, labels, or trailing commentary. Use this exact shape (the values below are synthetic placeholders; never copy them): ${schemas[type]}. Read values from the image, do not use the placeholders. If a value is unreadable, omit that entry rather than guessing.`;
}
