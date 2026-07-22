# CoC Companion

CoC Companion is a **100% read-only** Clash of Clans companion. It uses only the official public Clash of Clans API, performs zero game-client interaction or automation, and never performs in-game actions. All actions remain manual for the human player.

The player is identified only by a public player tag. No Supercell account credentials are collected. `COC_API_KEY` is stored only as an encrypted Cloudflare Worker Secret and is never sent to the dashboard.

## Development

Wrangler 4.103.0 requires Node.js 22 or newer.

```sh
npm install
npm run typecheck
npm test
npm run dev
```

Refresh the trimmed static catalog after an upstream game-data update:

```sh
node scripts/build-catalog.mjs
```

The generated `config/game-data.json` contains only upgrade requirements, costs,
times, and resource types for heroes, troops, spells, buildings, and traps. It
is attributed to coc.guide via coc.py (MIT), with source/access metadata stored
in the file.

`config/unlock-requirements.json` is a separately curated, community-consensus
map of actual home-village unlock Town Halls. It intentionally has a safe
default: entities absent from the map are not presented as unlockable.

Create a KV namespace and update the placeholder IDs in `wrangler.toml`:

```sh
npx wrangler kv namespace create STATE
npx wrangler kv namespace create STATE --preview
npx wrangler secret put COC_API_KEY
npm run deploy
```

The dashboard is a static site in `dashboard/`. Deploy it with Cloudflare Pages using the dashboard directory as the output directory (no build command), or serve it locally with any static HTTP server. Set the Worker URL in the dashboard settings. The dashboard stores only the Worker URL and player tag in `localStorage`.

## API routes

- `GET /api/status`
- `GET /api/player/:tag`
- `GET /api/recommendations/:tag`
- `GET /api/feed/:tag`
- `GET /api/base/:tag` and `POST /api/base/:tag` for estimated builders, resources,
  goals, and manually entered building levels
- `GET /api/plan/:tag` for account completion and ranked next-best actions
- `GET /api/done/:tag`, `POST /api/done/:tag`, and `DELETE /api/done/:tag`
  for the one-at-a-time upgrade checklist
- `GET /api/skip/:tag`, `POST /api/skip/:tag`, and `DELETE /api/skip/:tag`
  for authenticated “skip for now” actions; skipped actions move behind active
  actions and return with a previously-skipped note when all actions are skipped
- `POST /api/auth/register` and `POST /api/auth/login` for app accounts, plus
  `POST /api/auth/logout`
- `GET /api/war/:clanTag` for current-war stars, destruction, attack usage, and
  unattacked members
- `GET /api/clan/:clanTag` for clan/member donation analytics and top donors
- `GET /api/capital/:clanTag` for the latest Capital Raid summary and top raiders
- `GET /api/predict/war/:tag` for advisory current-war matchup probabilities
- `GET /api/benchmark/:tag` for a collecting-state or bounded population benchmark
- `POST /api/watch/:tag` to register a tag for five-minute polling
- `DELETE /api/watch/:tag` to stop polling
- `POST /api/ask` with `{ "tag": "#TAG", "question": "..." }`
- Scheduled polling every five minutes for tags registered as `watch:<tag>` in KV. The dashboard registers the tag when loading a snapshot.

The Clan & War dashboard section uses the loaded player's clan tag automatically.
War attack notifications are derived from compact per-member attack fingerprints
while a war is active. The analytics patterns were inspired by open-source
community projects including
[ClashKingBot/clashperk](https://github.com/ClashKingBot/clashperk),
[clashogram](https://github.com/clashogram), and
[DonationLogger](https://github.com/ClashKingBot/DonationLogger); no code was
copied from those projects.

## Limits and design choices

- Cloudflare KV Free includes only 1,000 writes/day. Snapshots and feeds are written only when the snapshot changes; caching follows API `Cache-Control` max-age.
- The public API does not expose shields or Clan Games state. Shield-expiry notifications are omitted. Clan Games ending-soon notifications are omitted rather than inferred.
- Clan war, Capital Raid, and Gold Pass fetch failures are isolated so a player snapshot can still load.
- The default API base is the RoyaleAPI proxy (`https://cocproxy.royaleapi.dev/v1`) because the supplied key is IP-locked to proxy egress `45.79.218.79`; configure `COC_API_BASE_URL` to override it. Direct `https://api.clashofclans.com/v1` works when your key is configured for a stable permitted IP. API keys are IP-bound; 403 `invalidIp`, 429 rate limits, and 503 maintenance are surfaced as typed errors. Retries use exponential backoff with jitter and honor `Retry-After`.
- Workers AI is optional. `AI_DAILY_CAP` defaults to a conservative 8,000 estimated-neuron proxy per UTC day. The default model is `@cf/openai/gpt-oss-120b`, with ordered fallbacks configured through `AI_FALLBACK_MODELS` (currently Llama 3.3 70B Fast, then Llama 3.2 3B). Per-model failures advance through the chain without changing the deterministic plan; budget exhaustion returns rules-only text.
- The exact upgrade priorities and army suggestions are sourced from `research/strategy-meta.md` and carry confidence labels. Several lower-TH current rankings are marked unverified because source pages were inaccessible during research.
- The analyzer labels provenance as `observed` (official payload), `calculated` (payload plus catalog), `estimated` (manual input), or `unavailable` (not exposed by the API). Buildings, walls, resources, builder availability, and active timers remain unavailable until entered manually.
- Manual base data can also include ore balances, wall level/count, magic-item inventory, Clan Games activity, a builder backlog copied from the in-game upgrade list, a four-hero lineup, and up to twelve-unit war/home army setups. Builder backlog costs are matched against the runtime catalog only when the name and cost produce a unique target level; ambiguous or stale matches remain explicitly un-inferred. These are user-entered planning inputs; walls, magic-item inventory, Clan Games state, builder queues, ore, upgrade timers, and armies used in attacks are not exposed by the API.
- Builder backlog inference also recognizes 90%, 85%, and 80% Gold Pass-discounted costs, preferring exact display-rounded matches and otherwise allowing a small tolerance. Discounted matches are labeled `inferred from discounted cost (Gold Pass boost)` and remain unset when multiple level/discount combinations match.
- App authentication protects writes to watches, manual base state, and the
  completed-action checklist. It is not a Supercell login: passwords are stored
  only as salted PBKDF2-SHA256 hashes (120,000 iterations), and 30-day random
  session tokens are stored in KV with expiration. Passwords are never stored
  in plaintext and the account does not grant access to the game.
- Account analysis compares levels against Town Hall caps from the catalog and reports unlockable entities, achievement highlights, category completion, and overall completion. API `maxLevel` is treated as an API/global fallback, not a Town Hall cap.
- Game data is refreshed automatically at runtime from the coc.py master
  `static_data.json` source. The Worker checks `catalog:v1` KV first, fetches
  and trims the upstream source with a 10-second timeout when the cache is
  absent, stores it for 24 hours, and falls back to the bundled catalog if
  upstream is unavailable. Plans expose `catalogMeta` with the source,
  fetch date, and live/cached/bundled mode.
- Dashboard copy humanizes recommendation categories, feed event types, action
  labels, provenance, resources, and identity/equipment spacing.
- Live player payload checks for TH7 (`#R2RVUQG89`) and TH16 (`#2PVR0VL89`)
  contained no separate `pets` field or pet entries in `troops`; the dashboard
  therefore does not render a speculative Pets table. Super Troops are likewise
  temporary boosts and are excluded from progression analysis and completion.
- Seasonal/temporary zero-cost catalog entries are excluded from completion and
  unlock analysis. Unlock cards are capped and include their prerequisite
  Barracks, Dark Barracks, Laboratory, or Hero Hall.
- Next-best-action scoring combines strategic value, unlock value, confidence, cost/time, goal, affordability, and builder/laboratory gating. Workers AI receives the top eight ranked actions for an expert-panel review, but never changes the ranked rules list. Missing AI, model failures, or budget exhaustion fall back to rules-only text.

### CoC Strategist ML advisory

Manual planning endpoints include `GET /api/timers/:tag`, `POST`/`DELETE
/api/timers/:tag`, `GET /api/rush/:tag`, and `GET
/api/equipment/:tag?goal=war`. Timers, rushed-base reports, ore-aware
equipment breakpoints, hero lineups, pet pairings, and selected war/home
armies are advisory inputs only. The public API does not expose defenses,
walls, magic-item inventory, Clan Games state, resources, ore, upgrade timers,
army compositions used in attacks, layouts, or replays; the dashboard labels
those manual or unavailable values explicitly. Magic-item suggestions never
perform or automate a game action.

The optional strategist collector stores only self-collected public API
snapshots and war events in the `DATA` R2 bucket. A compact version-1 JSON
artifact (linear or gradient-boosted trees) is validated and served from the
`MODELS` bucket; the Worker evaluates it in pure TypeScript and rolls back to
the last valid artifact or a deterministic Town Hall/hero heuristic. Training
materials and the publishing loop are in `training/`, including the
[model card](training/MODEL_CARD.md).

ML output is advisory-only: it never automates attacks, chooses targets in the
game client, changes a village, or replaces deterministic upgrade rules. The
public API has no replays, attack paths, army compositions used in attacks,
base layouts, telemetry, hidden resources, or timers. Until enough comparable
snapshots are collected, benchmark responses honestly use a `collecting` state.

## ToS boundary

This project does not automate the game, interact with a game client, perform attacks, alter villages, or collect Supercell credentials. It is a read-only informational dashboard backed by the official API.
