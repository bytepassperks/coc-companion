import { mkdir, writeFile } from "node:fs/promises";
import { CATALOG_SOURCE, trimCatalog } from "../src/catalogTrim.mjs";

const response = await fetch(CATALOG_SOURCE);
if (!response.ok) throw new Error(`Catalog fetch failed: ${response.status}`);
const source = await response.json();
const catalog = trimCatalog(source, "2026-07-21");

await mkdir(new URL("../config/", import.meta.url), { recursive: true });
await writeFile(new URL("../config/game-data.json", import.meta.url), `${JSON.stringify(catalog)}\n`);
console.log(`Wrote config/game-data.json (${JSON.stringify(catalog).length} bytes)`);
