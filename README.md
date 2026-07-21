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
- `POST /api/auth/register` and `POST /api/auth/login` for app accounts, plus
  `POST /api/auth/logout`
- `GET /api/war/:clanTag` for current-war stars, destruction, attack usage, and
  unattacked members
- `GET /api/clan/:clanTag` for clan/member donation analytics and top donors
- `GET /api/capital/:clanTag` for the latest Capital Raid summary and top raiders
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
- Workers AI is optional. `AI_DAILY_CAP` defaults to a conservative 8,000 estimated-neuron proxy per UTC day. When unavailable or near the cap, the rules-based recommendation text is returned.
- The exact upgrade priorities and army suggestions are sourced from `research/strategy-meta.md` and carry confidence labels. Several lower-TH current rankings are marked unverified because source pages were inaccessible during research.
- The analyzer labels provenance as `observed` (official payload), `calculated` (payload plus catalog), `estimated` (manual input), or `unavailable` (not exposed by the API). Buildings, walls, resources, builder availability, and active timers remain unavailable until entered manually.
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
- Live player payload checks for TH7 (`#R2RVUQG89`) and TH16 (`#2PVR0VL89`)
  contained no separate `pets` field or pet entries in `troops`; the dashboard
  therefore does not render a speculative Pets table. Super Troops are likewise
  temporary boosts and are excluded from progression analysis and completion.
- Seasonal/temporary zero-cost catalog entries are excluded from completion and
  unlock analysis. Unlock cards are capped and include their prerequisite
  Barracks, Dark Barracks, Laboratory, or Hero Hall.
- Next-best-action scoring combines strategic value, unlock value, confidence, cost/time, goal, affordability, and builder/laboratory gating. Workers AI narrates the plan only; it never changes the ranked rules list, and missing AI or budget exhaustion falls back to rules-only text.

## ToS boundary

This project does not automate the game, interact with a game client, perform attacks, alter villages, or collect Supercell credentials. It is a read-only informational dashboard backed by the official API.
