"""Train and export a Worker-safe CoC attack-outcome artifact.

XGBoost is preferred when installed. Its JSON dump is converted to the
minimal tree representation evaluated by src/model.ts. Logistic regression
from sklearn, then a small pure-Python gradient descent implementation, are
fallbacks.
"""
import argparse
import json
import math
import os
import random
from datetime import datetime, timezone

FEATURES = ["attackerTH", "defenderTH", "thDiff", "attackerHeroTotal"]


def rows(path):
    if not path or not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            try:
                row = json.loads(line)
                if row.get("stars") is not None:
                    yield row
            except (json.JSONDecodeError, TypeError):
                continue


def vector(row):
    attacker = float(row.get("attackerTH") or 0)
    defender = float(row.get("defenderTH") or 0)
    heroes = row.get("attackerHeroLevels")
    hero_total = row.get("attackerHeroTotal")
    if hero_total is None:
        hero_total = sum((heroes or {}).values())
    return [attacker, defender, attacker - defender, float(hero_total or 0)]


def sigmoid(value):
    return 1 / (1 + math.exp(-max(-30, min(30, value))))


def auc_score(labels, probabilities):
    positives = sorted(probability for label, probability in zip(labels, probabilities) if label)
    negatives = sorted(probability for label, probability in zip(labels, probabilities) if not label)
    if not positives or not negatives:
        return 0.5
    wins = sum(1 if positive > negative else 0.5 if positive == negative else 0
               for positive in positives for negative in negatives)
    return wins / (len(positives) * len(negatives))


def logistic_fallback(train_x, train_y):
    try:
        from sklearn.linear_model import LogisticRegression
        model = LogisticRegression(max_iter=500, solver="lbfgs")
        model.fit(train_x, train_y)
        return "sklearn-logistic", list(model.coef_[0]), float(model.intercept_[0]), lambda values: float(model.predict_proba([values])[0][1])
    except (ImportError, ValueError):
        weights = [0.0] * len(FEATURES)
        bias = 0.0
        for _ in range(1200):
            gradients = [0.0] * len(FEATURES)
            bias_gradient = 0.0
            for values, label in zip(train_x, train_y):
                prediction = sigmoid(bias + sum(weight * value for weight, value in zip(weights, values)))
                error = prediction - label
                for index, value in enumerate(values):
                    gradients[index] += error * value / max(1, len(train_x))
                bias_gradient += error / max(1, len(train_x))
            for index in range(len(weights)):
                weights[index] -= 0.01 * gradients[index]
            bias -= 0.01 * bias_gradient
        return "python-logistic", weights, bias, lambda values: sigmoid(bias + sum(weight * value for weight, value in zip(weights, values)))


def export_xgb_tree(tree):
    nodes = []

    def visit(node):
        index = len(nodes)
        nodes.append(None)
        if "leaf" in node:
            nodes[index] = {"value": float(node["leaf"])}
            return index
        children = {str(child["nodeid"]): child for child in node["children"]}
        left = visit(children[str(node["yes"])])
        right = visit(children[str(node["no"])])
        nodes[index] = {
            "feature": int(str(node["split"]).removeprefix("f")),
            "threshold": float(node["split_condition"]),
            "left": left,
            "right": right,
        }
        return index

    return {"root": visit(tree), "nodes": nodes}


def xgb_base_margin(booster):
    try:
        config = json.loads(booster.save_config())
        value = config["learner"]["learner_model_param"]["base_score"]
        if isinstance(value, str):
            value = value.strip("[]").split(",")[0]
        probability = float(value)
        return math.log(probability / (1 - probability))
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return 0.0


def train_xgb(train_x, train_y, test_x):
    try:
        from xgboost import XGBClassifier
        if len(set(train_y)) < 2:
            return None
        model = XGBClassifier(
            n_estimators=48, max_depth=4, learning_rate=0.08,
            subsample=0.9, colsample_bytree=0.9,
            objective="binary:logistic", eval_metric="logloss",
            tree_method="hist", n_jobs=1,
        )
        model.fit(train_x, train_y)
        booster = model.get_booster()
        trees = [export_xgb_tree(json.loads(dump))
                 for dump in booster.get_dump(dump_format="json")]
        probabilities = [float(value) for value in model.predict_proba(test_x)[:, 1]]
        return {
            "backend": "xgboost",
            "artifact": {
                "type": "gbdt", "trees": trees, "bias": xgb_base_margin(booster),
                "calibration": {"slope": 1, "intercept": 0},
            },
            "probabilities": probabilities,
            "predict": lambda values: float(model.predict_proba([values])[0][1]),
        }
    except (ImportError, ValueError, RuntimeError, AttributeError):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=os.environ.get("ATTACKS_JSONL", "attacks.jsonl"))
    parser.add_argument("--output", default="artifact.json")
    parser.add_argument("--model-card", default="MODEL_CARD.md")
    parser.add_argument("--verification", default=None)
    args = parser.parse_args()
    data = sorted(list(rows(args.input)), key=lambda row: row.get("fetched_at", ""))
    if len(data) < 2:
        raise SystemExit("Need at least two attack rows")
    split = min(len(data) - 1, max(1, int(len(data) * 0.8)))
    train, test = data[:split], data[split:]
    train_x, test_x = [vector(row) for row in train], [vector(row) for row in test]
    train_y = [int((row.get("stars") or 0) >= 2) for row in train]
    test_y = [int((row.get("stars") or 0) >= 2) for row in test]
    trained = train_xgb(train_x, train_y, test_x) if len(set(train_y)) > 1 else None
    if trained is None:
        backend, weights, bias, predict = logistic_fallback(train_x, train_y)
        trained = {
            "backend": backend,
            "artifact": {
                "type": "linear", "weights": weights, "bias": bias,
                "calibration": {"slope": 1, "intercept": 0},
            },
            "probabilities": [predict(values) for values in test_x],
            "predict": predict,
        }
    probabilities = trained["probabilities"]
    predictions = [int(value >= 0.5) for value in probabilities]
    accuracy = sum(actual == predicted for actual, predicted in zip(test_y, predictions)) / max(1, len(test_y))
    artifact = {
        "version": 1,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "features": FEATURES,
        **trained["artifact"],
        "metrics": {
            "test_accuracy": accuracy,
            "test_auc": auc_score(test_y, probabilities),
            "train_samples": len(train),
            "test_samples": len(test),
        },
        "minSamples": 100,
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(artifact, handle, separators=(",", ":"))
    verification_path = args.verification or os.path.join(os.path.dirname(args.output) or ".", "verification.json")
    random.seed(7)
    examples = random.sample(data, min(20, len(data)))
    with open(verification_path, "w", encoding="utf-8") as handle:
        json.dump({"features": FEATURES, "rows": [{"values": vector(row), "probability": trained["predict"](vector(row))} for row in examples]}, handle)
    with open(args.model_card, "w", encoding="utf-8") as handle:
        handle.write("# CoC Strategist attack predictor\n\n")
        handle.write(f"- Trained at: `{artifact['trainedAt']}`\n- Samples: `{len(data)}`\n")
        handle.write(f"- Backend: `{trained['backend']}`\n- Time-based holdout accuracy: `{accuracy:.6f}`\n")
        handle.write(f"- Time-based holdout AUC: `{artifact['metrics']['test_auc']:.6f}`\n")
        handle.write("- Label: binary 2+ stars from self-collected public war API rows.\n")
        handle.write("- Advisory only; the API exposes no replays, armies, or layouts.\n")
    print(json.dumps({"rows": len(data), "train": len(train), "test": len(test), "backend": trained["backend"], "accuracy": accuracy, "auc": artifact["metrics"]["test_auc"]}))


if __name__ == "__main__":
    main()
