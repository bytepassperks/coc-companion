import type { R2Bucket, KVNamespace } from "@cloudflare/workers-types";
import type { CurrentWar, Player } from "./types";

export interface ModelArtifactV1 {
  version: string | number;
  trainedAt: string;
  features: string[];
  type: "gbdt" | "linear";
  trees?: Array<{ nodes: Array<{ feature?: number; threshold?: number; left?: number; right?: number; value?: number }>; root?: number }>;
  weights?: number[];
  bias?: number;
  calibration?: { slope?: number; intercept?: number };
  metrics: Record<string, number>;
  minSamples: number;
  checksum?: string;
}

export interface ModelResult {
  probability: number;
  predictedStars: number;
  starProbabilities: Record<string, number>;
  modelMeta: { version: string; mode: "model" | "heuristic"; provenance: string };
}

const CACHE_KEY = "model:artifact:v1";

export function validateArtifact(value: unknown): value is ModelArtifactV1 {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<ModelArtifactV1>;
  if (!["1", 1, "v1"].includes(artifact.version as string | number) || typeof artifact.trainedAt !== "string" || !Array.isArray(artifact.features) ||
      !artifact.features.every((feature) => typeof feature === "string") ||
      !["gbdt", "linear"].includes(artifact.type ?? "") ||
      typeof artifact.minSamples !== "number" || !Number.isFinite(artifact.minSamples) || artifact.minSamples < 0 ||
      !artifact.metrics || typeof artifact.metrics !== "object" ||
      Object.values(artifact.metrics).some((metric) => typeof metric !== "number" || !Number.isFinite(metric))) return false;
  if (artifact.calibration && Object.values(artifact.calibration).some((value) => typeof value !== "number" || !Number.isFinite(value))) return false;
  if (artifact.type === "linear" && (!Array.isArray(artifact.weights) || artifact.weights.length !== artifact.features.length ||
      artifact.weights.some((weight) => !Number.isFinite(weight)))) return false;
  if (artifact.type === "gbdt" && (!Array.isArray(artifact.trees) || artifact.trees.some((tree) =>
    !Array.isArray(tree.nodes) || tree.nodes.some((node) => Object.values(node).some((value) => value !== undefined && !Number.isFinite(value as number)))))) return false;
  return true;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadArtifact(models: R2Bucket, state: KVNamespace): Promise<{ artifact?: ModelArtifactV1; mode: "model" | "heuristic"; version: string }> {
  const cached = await state.get<ModelArtifactV1>(CACHE_KEY, "json");
  if (validateArtifact(cached)) return { artifact: cached, mode: "model", version: String(cached.version) };
  try {
    const pointerObject = await models.get("latest.json");
    if (!pointerObject) throw new Error("latest model pointer missing");
    const pointer = JSON.parse(await pointerObject.text()) as { key?: string; checksum?: string; version?: string };
    if (!pointer.key) throw new Error("latest model pointer invalid");
    const artifactObject = await models.get(pointer.key);
    if (!artifactObject) throw new Error("model artifact missing");
    const artifact = JSON.parse(await artifactObject.text()) as unknown;
    if (!validateArtifact(artifact)) throw new Error("model artifact schema invalid");
    if (pointer.checksum) {
      const actual = await sha256(canonicalArtifact(artifact));
      if (actual !== pointer.checksum) throw new Error("model artifact checksum mismatch");
    }
    const prior = await state.get<ModelArtifactV1>(CACHE_KEY, "json");
    if (validateArtifact(prior)) await state.put("model:previous:v1", JSON.stringify(prior));
    await state.put(CACHE_KEY, JSON.stringify(artifact), { expirationTtl: 21600 });
    return { artifact, mode: "model", version: pointer.version ?? String(artifact.version) };
  } catch {
    const previous = await state.get<ModelArtifactV1>("model:previous:v1", "json");
    if (validateArtifact(previous)) return { artifact: previous, mode: "model", version: String(previous.version) };
    return { mode: "heuristic", version: "heuristic" };
  }
}

export function evaluateArtifact(artifact: ModelArtifactV1, features: Record<string, number>): number {
  const vector = artifact.features.map((feature) => finite(features[feature]));
  let score = artifact.bias ?? 0;
  if (artifact.type === "linear") score += (artifact.weights ?? []).reduce((sum, weight, index) => sum + weight * (vector[index] ?? 0), 0);
  else score += (artifact.trees ?? []).reduce((sum, tree) => sum + evaluateTree(tree, vector), 0);
  const calibrated = score * (artifact.calibration?.slope ?? 1) + (artifact.calibration?.intercept ?? 0);
  return logistic(calibrated);
}

export function heuristicProbability(attacker: { townHallLevel?: number; heroes?: Array<{ level: number }> }, defender: { townhallLevel?: number; heroes?: Array<{ level: number }> }): number {
  const thDiff = (attacker.townHallLevel ?? 0) - (defender.townhallLevel ?? 0);
  const attackerHeroes = (attacker.heroes ?? []).reduce((sum, hero) => sum + hero.level, 0);
  const defenderHeroes = (defender.heroes ?? []).reduce((sum, hero) => sum + hero.level, 0);
  return logistic(thDiff * 1.15 + (attackerHeroes - defenderHeroes) / 35);
}

export function predictWar(artifact: ModelArtifactV1 | undefined, player: Player, war: CurrentWar): Array<ModelResult & { attackerTag: string; defenderTag?: string; mapPosition?: number; starsTarget: number }> {
  const opponents = new Map((war.opponent?.members ?? []).map((member) => [member.mapPosition, member]));
  return (war.clan?.members ?? []).map((member) => {
    const defender = member.mapPosition === undefined ? undefined : opponents.get(member.mapPosition);
    const features = {
      attackerTH: member.townHallLevel ?? player.townHallLevel,
      defenderTH: defender?.townHallLevel ?? member.townHallLevel ?? player.townHallLevel,
      thDiff: (member.townHallLevel ?? player.townHallLevel) - (defender?.townHallLevel ?? member.townHallLevel ?? player.townHallLevel),
      attackerHeroTotal: member.tag === player.tag ? (player.heroes ?? []).reduce((sum, hero) => sum + hero.level, 0) : 0,
    };
    const probability = artifact ? evaluateArtifact(artifact, features) : heuristicProbability(
      { townHallLevel: features.attackerTH, heroes: member.tag === player.tag ? player.heroes : [] },
      { townhallLevel: features.defenderTH },
    );
    const stars = Math.max(0, Math.min(3, Math.round(probability * 3)));
    const rawStarProbabilities = { "0": (1 - probability) * 0.2, "1": (1 - probability) * 0.3, "2": probability * 0.55, "3": probability * 0.45 };
    const probabilityTotal = Object.values(rawStarProbabilities).reduce((sum, value) => sum + value, 0);
    return {
      probability,
      predictedStars: stars,
      starProbabilities: Object.fromEntries(Object.entries(rawStarProbabilities).map(([key, value]) => [key, value / probabilityTotal])),
      modelMeta: { version: artifact ? String(artifact.version) : "heuristic", mode: artifact ? "model" : "heuristic", provenance: artifact ? "self-collected public API war data" : "deterministic TH/hero heuristic" },
      attackerTag: member.tag,
      defenderTag: defender?.tag,
      mapPosition: defender?.mapPosition,
      starsTarget: 2,
    };
  });
}

function evaluateTree(tree: NonNullable<ModelArtifactV1["trees"]>[number], vector: number[]) {
  let index = tree.root ?? 0;
  for (let steps = 0; steps < tree.nodes.length + 1; steps += 1) {
    const node = tree.nodes[index];
    if (!node) return 0;
    if (node.value !== undefined) return node.value;
    index = vector[node.feature ?? 0] < (node.threshold ?? 0) ? node.left ?? 0 : node.right ?? 0;
  }
  return 0;
}

function finite(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function logistic(value: number) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function canonicalArtifact(artifact: ModelArtifactV1) {
  const { checksum: _checksum, ...withoutChecksum } = artifact;
  return JSON.stringify(withoutChecksum);
}
