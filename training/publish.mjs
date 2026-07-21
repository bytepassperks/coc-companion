import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const bucket = process.env.CLOUDFLARE_MODEL_BUCKET || "coc-strategist-models";
const artifactPath = process.argv[2] || "artifact.json";
if (!account || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
if (artifact.version !== 1 || !Array.isArray(artifact.features) || !["linear", "gbdt"].includes(artifact.type)) throw new Error("Invalid model artifact");
if (artifact.features.some((feature) => typeof feature !== "string") || Object.values(artifact.metrics || {}).some((value) => !Number.isFinite(value))) throw new Error("Invalid model ranges");
const body = JSON.stringify(artifact);
const checksum = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "checksum")))).digest("hex");
const version = `${artifact.version}-${artifact.trainedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects`;
async function put(key, content) {
  const response = await fetch(`${base}/${encodeURIComponent(key)}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: content });
  if (!response.ok) throw new Error(`R2 upload failed ${response.status}: ${await response.text()}`);
}
await put(`artifacts/${version}.json`, body);
await put("latest.json", JSON.stringify({ key: `artifacts/${version}.json`, checksum, version }));
console.log(JSON.stringify({ version, checksum }));
