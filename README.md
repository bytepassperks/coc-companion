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
- `POST /api/watch/:tag` to register a tag for five-minute polling
- `DELETE /api/watch/:tag` to stop polling
- `POST /api/ask` with `{ "tag": "#TAG", "question": "..." }`
- Scheduled polling every five minutes for tags registered as `watch:<tag>` in KV. The dashboard registers the tag when loading a snapshot.

## Limits and design choices

- Cloudflare KV Free includes only 1,000 writes/day. Snapshots and feeds are written only when the snapshot changes; caching follows API `Cache-Control` max-age.
- The public API does not expose shields or Clan Games state. Shield-expiry notifications are omitted. Clan Games ending-soon notifications are omitted rather than inferred.
- Clan war, Capital Raid, and Gold Pass fetch failures are isolated so a player snapshot can still load.
- The default API base is the RoyaleAPI proxy (`https://cocproxy.royaleapi.dev/v1`) because the supplied key is IP-locked to proxy egress `45.79.218.79`; configure `COC_API_BASE_URL` to override it. Direct `https://api.clashofclans.com/v1` works when your key is configured for a stable permitted IP. API keys are IP-bound; 403 `invalidIp`, 429 rate limits, and 503 maintenance are surfaced as typed errors. Retries use exponential backoff with jitter and honor `Retry-After`.
- Workers AI is optional. `AI_DAILY_CAP` defaults to a conservative 8,000 estimated-neuron proxy per UTC day. When unavailable or near the cap, the rules-based recommendation text is returned.
- The exact upgrade priorities and army suggestions are sourced from `research/strategy-meta.md` and carry confidence labels. Several lower-TH current rankings are marked unverified because source pages were inaccessible during research.

## ToS boundary

This project does not automate the game, interact with a game client, perform attacks, alter villages, or collect Supercell credentials. It is a read-only informational dashboard backed by the official API.
