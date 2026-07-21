# Weekly CoC Strategist training loop

1. The Worker cron collects bounded public API snapshots and attack rows into
   `coc-strategist-data` under `raw/` and `events/attacks/`.
2. A weekly private Kaggle script receives a JSONL export, sorts by
   `fetched_at`, makes a time-based split, trains/evaluates the advisory
   predictor, and emits `artifact.json` plus `MODEL_CARD.md`.
3. A controller runs `kaggle kernels push`, polls `kaggle kernels status`, and
   downloads `kaggle kernels output`. Kaggle credentials are environment
   secrets (`KAGGLE_API_TOKEN`) and never committed.
4. Validate the artifact locally, then run:

   ```sh
   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
     node training/publish.mjs artifact.json
   ```

   The script uploads a versioned object to `MODELS` through the R2 REST API
   and updates `latest.json` only after schema/range validation.
5. The Worker validates the pointer, artifact schema, finite numeric ranges,
   and optional SHA-256 checksum. It caches a valid artifact in KV for six
   hours. Failures use a deterministic TH/hero heuristic and never break the
   API.
6. Keep the previous artifact and pointer for rollback. Promote only when
   minimum samples, time-split metrics, calibration and drift gates pass.

The predictor is advisory-only. It must not automate attacks, select targets
in the game client, or imply access to replays, armies or base layouts.
