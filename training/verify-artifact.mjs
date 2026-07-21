import { readFile } from "node:fs/promises";

const artifactPath = process.argv[2] || "/home/ubuntu/corpus/artifact.json";
const verificationPath = process.argv[3] || "/home/ubuntu/corpus/verification.json";
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const verification = JSON.parse(await readFile(verificationPath, "utf8"));

function logistic(value) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function evaluateTree(tree, vector) {
  let index = tree.root || 0;
  for (let steps = 0; steps <= tree.nodes.length; steps += 1) {
    const node = tree.nodes[index];
    if (!node) throw new Error(`invalid tree node ${index}`);
    if (node.value !== undefined) return node.value;
    index = vector[node.feature || 0] < (node.threshold || 0) ? node.left || 0 : node.right || 0;
  }
  throw new Error("tree did not terminate");
}

function evaluate(values) {
  let score = artifact.bias || 0;
  if (artifact.type === "linear") {
    score += (artifact.weights || []).reduce((sum, weight, index) => sum + weight * (values[index] || 0), 0);
  } else {
    score += (artifact.trees || []).reduce((sum, tree) => sum + evaluateTree(tree, values), 0);
  }
  score = score * (artifact.calibration?.slope ?? 1) + (artifact.calibration?.intercept ?? 0);
  return logistic(score);
}

let maxDiff = 0;
for (const row of verification.rows) {
  const difference = Math.abs(evaluate(row.values) - row.probability);
  maxDiff = Math.max(maxDiff, difference);
}
console.log(JSON.stringify({ checked: verification.rows.length, maxDiff }));
if (maxDiff >= 1e-6) process.exitCode = 1;
