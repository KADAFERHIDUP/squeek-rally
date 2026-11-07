# Squeek Orbit shared server

A Cloudflare Worker + D1 (SQLite) that gives every Squeek Orbit player the same world: a global Rallyon leaderboard, one raid crowd, the Broadcastia audience poll, and a permanent history of on-chain round settlements. It fits in Cloudflare's free plan.

## Deploy (about 5 minutes)

You need a free Cloudflare account and Node 18+.

```bash
cd server
npx wrangler login
npx wrangler d1 create squeek-orbit          # copy the database_id it prints into wrangler.toml
npx wrangler d1 execute squeek-orbit --remote --file=schema.sql
npx wrangler deploy                          # prints https://squeek-orbit.<you>.workers.dev
```

Then point the site at it, either:

- in `js/config.js`: `backend: 'https://squeek-orbit.<you>.workers.dev'` (everyone gets it), or
- in Rallyon → Settings → Shared server (this browser only), or
- by adding `?server=https://squeek-orbit.<you>.workers.dev` to any link.

Set `ALLOWED_ORIGINS` in `wrangler.toml` to the site's origin (for example `https://kadaferhidup.github.io`). Reads are open to everyone; writes from other origins are refused.

Check it: `curl https://squeek-orbit.<you>.workers.dev/v1/health`

## API

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/v1/health` | | round history size, current round, raid day |
| GET | `/v1/rounds` | `?ids=1,2,3` or `?from=&to=&limit=` | on-chain results recorded from Squeekchain `/settlements`; `work` is `null` when a settlement spans several rounds with work |
| GET | `/v1/leaderboard` | `?period=all\|week&limit=20` | best run per player |
| POST | `/v1/runs` | `{client, name, score, distanceM, seeds, coins, gems, durationS, multiplier, skin}` | validated against the game's top speed and pickup values; 1 run / 10 s per player, 40 / hour per IP |
| GET | `/v1/raid` | `?client=` | today's cheers (days run 12:00 to 12:00 UTC) |
| POST | `/v1/raid/cheer` | `{client, name}` | refused unless the wheel is turning right now (the server asks Squeekchain itself); 1 per 20 s per player |
| GET | `/v1/poll` | `?client=` | open poll for the next round, and the last settled poll |
| POST | `/v1/poll/vote` | `{client, round, choice: "run"\|"sleep"}` | only the next round is open; a vote can be changed until it starts |

`client` is a random id the browser makes once; `name` is the player's chosen nickname (3–20 letters, numbers, spaces, `_ . -`). Nothing else about a player is stored.

A cron runs every 5 minutes to copy `/settlements` into D1. The round history also refreshes itself on demand if the cron has not run for 5 minutes.

## Honest limits

Rallyon runs in the browser, so the server can only check that a run is physically possible for the game (speed, pickups, block crystals per minute). It cannot prove a run was played by hand. Cheers and votes are rate-limited per player and per IP, but one person with many browsers can still vote more than once.

## Test locally

`node tests/worker.test.mjs` from the repository root runs this Worker on Node's built-in SQLite (Node 22+) with a mocked Squeekchain.
