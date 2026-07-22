import { extractAiText } from "./ai";
import type { GameCatalog } from "./types";
import type { Player } from "./types";
import { inferBuilderBacklog } from "./builderBacklog";

export const OCR_TYPES = ["upgrades", "builders", "army", "hero", "ores"] as const;
export type OcrType = typeof OCR_TYPES[number];
export type OcrDraft = Record<string, unknown>;
export type OcrRoster = {
  troops: Array<{ name: string; level: number }>;
  spells: Array<{ name: string; level: number }>;
  heroes: Array<{ name: string; level: number }>;
  pets: string[];
  equipment: string[];
};

export function extractJsonBlock(text: string) {
  return extractJsonBlocks(text)[0];
}

export function extractJsonBlocks(text: string) {
  const unfenced = text.replace(/```(?:json)?/gi, "").replace(/```/g, "");
  const blocks: string[] = [];
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
        if (!stack.length) {
          blocks.push(unfenced.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return blocks;
}

const names = (value: unknown, max = 40) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const integer = (value: unknown, min = 0, max = 400) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const numericInteger = (value: unknown, min = 0, max = 1000000) => {
  if (integer(value, min, max)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed >= min && parsed <= max) return parsed;
  }
  return undefined;
};

export function parseOcrResponse(raw: unknown, type: OcrType, catalog?: GameCatalog): OcrDraft {
  const envelope = raw && typeof raw === "object" && "response" in raw ? (raw as { response?: unknown }).response : undefined;
  let parsed: unknown = envelope && typeof envelope !== "string" ? envelope : undefined;
  if (envelope && typeof envelope !== "string") raw = undefined;
  const text = typeof raw === "string" ? raw : extractAiText(raw);
  if (parsed === undefined) {
    if (!text) throw new Error("OCR returned no structured data");
    const blocks = extractJsonBlocks(text);
    const candidates = blocks.length > 1 && blocks.every((block) => block.trim().startsWith("{"))
      ? [`[${blocks.join(",")}]`, ...blocks]
      : [...blocks, text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim()];
    for (const candidate of candidates) {
      try { if (candidate.trim()) { parsed = JSON.parse(candidate); break; } } catch { /* untrusted model output */ }
    }
  }
  if (parsed === undefined) throw new Error("OCR returned invalid JSON");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const response = (parsed as Record<string, unknown>).response;
    if (response !== undefined) parsed = response;
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
      if (!value || !names(value.label, 60) || !names(value.remaining, 30) || !/^\d+[dhms](?:\s+\d+[dhms]){0,3}$/i.test((value.remaining as string).trim()) || (value.kind !== undefined && !["builder", "lab", "pet", "hero", "other"].includes(String(value.kind)))) throw new Error("OCR returned an invalid builder entry");
      return { label: (value.label as string).trim(), remaining: (value.remaining as string).trim(), kind: value.kind ?? "other" };
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
  const oreNumber = (value: unknown) => {
    if (integer(value, 0, 1000000)) return value;
    if (typeof value === "string") {
      if (/^\d+$/.test(value.trim())) return numericInteger(value, 0, 1000000);
      const match = value.trim().match(/^(\d+)\s*\/\s*\d+$/);
      if (match) return Number(match[1]);
    }
    return undefined;
  };
  if (!parsed || typeof parsed !== "object" || oreNumber((parsed as Record<string, unknown>).shiny) === undefined || oreNumber((parsed as Record<string, unknown>).glowy) === undefined || oreNumber((parsed as Record<string, unknown>).starry) === undefined) throw new Error("OCR returned invalid ore balances");
  const value = parsed as Record<string, unknown>;
  const shiny = oreNumber(value.shiny)!;
  const glowy = oreNumber(value.glowy)!;
  const starry = oreNumber(value.starry)!;
  if (shiny === 12 && glowy === 34 && starry === 56) throw new Error("OCR repeated the prompt example instead of reading the image");
  const magicItems = value.magicItems && typeof value.magicItems === "object"
    ? Object.fromEntries(Object.entries(value.magicItems).flatMap(([key, count]) => {
      const parsed = numericInteger(count, 0, 99);
      return parsed === undefined ? [] : [[key, parsed]];
    }))
    : undefined;
  return { shiny, glowy, starry, ...(magicItems ? { magicItems } : {}) };
}

export function ocrPrompt(type: OcrType, roster?: OcrRoster) {
  const schemas: Record<OcrType, string> = {
    upgrades: '[{"name":"Example Tower","count":2,"cost":123456,"resource":"Gold"}]',
    builders: '[{"label":"Example Builder -> level 2","remaining":"1m 2s","kind":"other"}]',
    army: '[{"name":"Example Troop","count":3,"level":4}]',
    hero: '[{"hero":"Example Hero","equipment":["Example Equipment"],"pet":"Example Pet"}]',
    ores: '{"shiny":"12/345","glowy":"34/456","starry":"56/789","magicItems":{"bookOfHeroes":2}}',
  };
  const oreHint = type === "ores" ? "For ores, read the three pill-shaped counters at the bottom of the Hero Equipment screen: blue Shiny like 2253/45000, purple Glowy like 273/4500, and yellow Starry like 369/900. Report the number before each slash, not equipment level badges such as 9/17/24. Numeric strings are acceptable." : "";
  const builderHint = type === "builders" ? "Look for the Upgrade in progress popup. Return every visible row, using labels like Earthquake Spell -> level 6 and remaining like 29m 3s or 1d 42m 3s. Infer kind: lab for troop/spell research, hero for hero upgrades, pet for pet upgrades, builder for buildings, otherwise other." : "";
  const armyHint = type === "army" ? "List EVERY troop, spell, and siege machine visible, including clan castle sections; do not stop after the first few entries." : "";
  return `Read this mobile Clash of Clans game screenshot. ${builderHint} ${armyHint}${rosterText(roster)} Respond with ONLY minified JSON, with no markdown, prose, labels, or trailing commentary. Use this exact shape (the values below are synthetic placeholders; never copy them): ${schemas[type]}. Read values from the image, do not use the placeholders. ${oreHint} If a value is unreadable, omit that entry rather than guessing.`;
}

function rosterText(roster: OcrRoster | undefined) {
  if (!roster) return "";
  const compact = {
    troops: roster.troops.map((unit) => unit.name),
    spells: roster.spells.map((unit) => unit.name),
    heroes: roster.heroes.map((hero) => hero.name),
    pets: roster.pets,
    equipment: roster.equipment,
  };
  return ` The player owns ONLY these units and names: ${JSON.stringify(compact)}. Every name in your answer MUST be copied from these lists; do not invent or visually substitute a name.`;
}

export function buildOcrRoster(player: Player): OcrRoster {
  return {
    troops: (player.troops ?? []).filter((unit) => unit.village !== "builderBase").map((unit) => ({ name: unit.name, level: unit.level })),
    spells: (player.spells ?? []).filter((unit) => unit.village !== "builderBase").map((unit) => ({ name: unit.name, level: unit.level })),
    heroes: (player.heroes ?? []).filter((hero) => hero.village !== "builderBase").map((hero) => ({ name: hero.name, level: hero.level })),
    pets: (player.pets ?? []).map((pet) => pet.name),
    equipment: [...new Set([
      ...(player.heroEquipment ?? []).map((item) => item.name),
      ...(player.heroes ?? []).flatMap((hero) => (hero.equipment ?? []).map((item) => item.name)),
    ])],
  };
}

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function distance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j];
      row[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : Math.min(diagonal + 1, row[j] + 1, row[j - 1] + 1);
      diagonal = above;
    }
  }
  return row[right.length];
}

export function snapRosterName(value: string, roster: string[]) {
  const input = normalizedName(value);
  const exact = roster.find((name) => normalizedName(name) === input);
  if (exact) return { name: exact, unmatched: false };
  const singular = input.endsWith("s") ? input.slice(0, -1) : input;
  const plural = roster.find((name) => {
    const normalized = normalizedName(name);
    return normalized === singular || (normalized.endsWith("s") && normalized.slice(0, -1) === input);
  });
  if (plural) return { name: plural, unmatched: false };
  const contained = roster.find((name) => normalizedName(name).includes(input) || input.includes(normalizedName(name)));
  if (contained) return { name: contained, unmatched: false };
  const nearest = roster.map((name) => ({ name, score: distance(input, normalizedName(name)) }))
    .sort((left, right) => left.score - right.score)[0];
  if (nearest && nearest.score <= 2) return { name: nearest.name, unmatched: false };
  return { name: value, unmatched: true };
}

export function groundArmyDraft(draft: OcrDraft, player: Player): OcrDraft {
  const roster = buildOcrRoster(player);
  const units = [...roster.troops, ...roster.spells, ...roster.heroes];
  const levels = new Map(units.map((unit) => [normalizedName(unit.name), unit.level]));
  const names = units.map((unit) => unit.name);
  return {
    ...draft,
    entries: (draft.entries as Array<Record<string, unknown>>).map((entry) => {
      const snapped = snapRosterName(String(entry.name), names);
      const level = levels.get(normalizedName(snapped.name));
      return { ...entry, name: snapped.name, ...(level === undefined ? {} : { level }), ...(snapped.unmatched ? { unmatched: true } : {}) };
    }),
  };
}

export function groundHeroDraft(draft: OcrDraft, player: Player): OcrDraft {
  const roster = buildOcrRoster(player);
  return {
    ...draft,
    entries: (draft.entries as Array<Record<string, unknown>>).map((entry) => {
      const hero = snapRosterName(String(entry.hero), roster.heroes.map((item) => item.name));
      const heroEquipment = roster.equipment;
      const equipment = (entry.equipment as string[]).map((item) => snapRosterName(item, heroEquipment));
      const pet = entry.pet ? snapRosterName(String(entry.pet), roster.pets) : undefined;
      return {
        ...entry,
        hero: hero.name,
        equipment: equipment.map((item) => item.name),
        ...(hero.unmatched || equipment.some((item) => item.unmatched) || pet?.unmatched ? { unmatched: true } : {}),
      };
    }),
  };
}
