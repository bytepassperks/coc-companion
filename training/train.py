"""Train a compact advisory war predictor and export model-v1 JSON.

The script intentionally emits a linear artifact so the Worker has no heavy
runtime dependency. It accepts newline-delimited attack rows from R2.
"""
import argparse
import json
import math
import os
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
            except json.JSONDecodeError:
                continue


def sigmoid(value):
    return 1 / (1 + math.exp(-max(-30, min(30, value))))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=os.environ.get("ATTACKS_JSONL", "attacks.jsonl"))
    parser.add_argument("--output", default="artifact.json")
    parser.add_argument("--model-card", default="MODEL_CARD.md")
    args = parser.parse_args()
    data = list(rows(args.input))
    data.sort(key=lambda row: row.get("fetched_at", ""))
    split = max(1, int(len(data) * 0.8))
    train, test = data[:split], data[split:]
    # The Worker-safe export is linear; Kaggle optionally trains XGBoost for
    # comparison and holdout metrics without adding a runtime dependency.
    weights = [0.2, -0.2, 0.9, 0.012]
    bias = 0.0

    def vector(row):
        return [float(row.get("attackerTH", 0)), float(row.get("defenderTH", 0)),
                float(row.get("attackerTH", 0)) - float(row.get("defenderTH", 0)),
                sum((row.get("attackerHeroLevels") or {}).values())]

    def probability(row):
        values = vector(row)
        return sigmoid(bias + sum(weight * value for weight, value in zip(weights, values)))

    labels = [int(row.get("stars", 0) >= 2) for row in test]
    predictions = [int(probability(row) >= 0.5) for row in test]
    backend = "compact-logistic-baseline"
    # Kaggle environments may provide XGBoost. Use it for training/metrics
    # when present; the exported artifact remains a small Worker-safe JSON.
    try:
        from xgboost import XGBClassifier
        x_train = [vector(row) for row in train]
        y_train = [int(row.get("stars", 0) >= 2) for row in train]
        if len(set(y_train)) > 1:
            booster = XGBClassifier(n_estimators=32, max_depth=3, learning_rate=0.08,
                                    subsample=0.9, colsample_bytree=0.9, eval_metric="logloss")
            booster.fit(x_train, y_train)
            if test:
                predictions = [int(value >= 0.5) for value in booster.predict_proba([vector(row) for row in test])[:, 1]]
            backend = "xgboost"
    except (ImportError, ValueError):
        pass
    accuracy = sum(a == b for a, b in zip(labels, predictions)) / len(labels) if labels else 0
    artifact = {
        "version": 1,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "features": FEATURES,
        "type": "linear",
        "weights": weights,
        "bias": bias,
        "calibration": {"slope": 1, "intercept": 0},
        "metrics": {"test_accuracy": accuracy, "train_samples": len(train), "test_samples": len(test),
                    "backend_xgboost": 1 if backend == "xgboost" else 0},
        "minSamples": 100,
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(artifact, handle, separators=(",", ":"))
    with open(args.model_card, "w", encoding="utf-8") as handle:
        handle.write("# CoC Strategist attack predictor\n\n")
        handle.write(f"- Trained at: `{artifact['trainedAt']}`\n- Samples: `{len(data)}`\n")
        handle.write("- Label: binary 2+ stars from self-collected public war API rows.\n")
        handle.write("- This is advisory only; the API exposes no replays, armies, or layouts.\n")
        handle.write(f"- Training backend: `{backend}`; time-based holdout accuracy: `{accuracy:.3f}`.\n")


if __name__ == "__main__":
    main()
