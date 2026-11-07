# Squeek Orbit

**Eight planets orbiting the WHEELY9000, all powered by Squeekchain's real hamster.**

Squeektoshi runs on the WHEELY9000 and mines Squeek blocks on Squeekchain. Squeek Orbit is a single site shaped like a solar system: the sun is the wheel, spinning at Squeektoshi's live rpm, and each of the eight planets is one kind of Squeekchain build with its own mode. When the hamster runs, the whole system speeds up.

| # | Planet | Category | What you can do |
|---|---|---|---|
| 1 | **Rallyon** | Games & mods | **Squeek Rally**, a real-time 3D hamster-ball runner on a floating tile road. The road turns gold and Wheel Power boosts speed and score while the real wheel turns; every Squeek block mined while you play drops a block crystal. Menus: Play, Call round, Garage (4 skins to unlock), Leaderboard, How to play, Settings. |
| 2 | **Raidus** | Server games & bots | **Daily Boss Raid**: today's boss loses HP for every metre the hamster runs (same fight for everyone), a **Wheel Saga** that every round moves forward, and a ready-to-run **Discord bot**. |
| 3 | **Oraclea** | AI on the wheel | **Beat the AI**: a forecasting model in your browser calls the next round against you. **Wheel Painter**: a painting that grows from every live wheel reading and gets a star for every block. |
| 4 | **Broadcastia** | Stream companions & overlays | Transparent OBS overlays (compact, full, ticker) and a second-screen live view. |
| 5 | **Vaultar** | Utilities for holders | Read-only wallet check: every Squeek, its power and merge state, and a merge planner. Never connects a wallet or asks for a signature. |
| 6 | **Squeekhaven** | Apps for Squeek NFT holders | Look up any Squeek, name it, pin it to your showcase wall; verified-holder badge for Squeeks owned by your saved wallet. |
| 7 | **Fintopia** | SqueekFi | Staking-share calculator from the Proof of Squeek formulas and live network totals, plus a play-money market on the next round. |
| 8 | **Evolvia** | Dynamic NFTs | *Squeektoshi's Echo*, a creature whose stage, fur, aura and relics evolve with the hamster; exports ERC-721 style metadata. |

## Squeekchain data

Everything comes from the public, read-only API at `https://api.squeekchain.com/v1` (Sepolia), called straight from the browser. No backend, no keys, no wallet connection.

| Endpoint | Used for |
|---|---|
| `/status` | `measurement.coreStatus`, `rpmMilli`, `speedMmPerSecond`, `distanceMm` (daily, 12:00 to 12:00 UTC), `cumulativeWorkUnits`, `freshness`, `observedAt`; `builder.projected.blockHeight` / `blockProgress`; `builder.anchor.settledThroughRound` |
| `/economy/state` | SQK supply and cap, staking totals (`totalNftPower`, `totalSqkPower`), Squeeks live, current round |
| `/events` | the on-chain ticker on the home screen |
| `/measurement/stats?range=7d` | 7-day wheel statistics |
| `/accounts/{address}`, `/squeeks/{id}` | Vaultar and Squeekhaven lookups |

Rounds follow the official schedule: 600 seconds each from genesis `1793735400`, so `round = floor((t − genesis) / 600) + 1`. A round's distance is measured from the wheel's own work counter (`cumulativeWorkUnits`, one turn ≈ 0.88 m) between the round's start and end, so calls, duels and bets settle only for rounds the page watched from start to finish; anything else is refunded.

If the API cannot be reached, the site switches to clearly labelled demo data.

## Run it

Static files, no build step:

```
npx serve .
```

Deploy the folder as-is to GitHub Pages, Netlify or Vercel. For OBS overlays, add a Browser Source pointing at `https://<your-site>/#overlay-compact` (or `#overlay-full`, `#overlay-ticker`).

## Under the hood

- `js/engine.js`: a small WebGL2 renderer written for this project (instanced low-poly meshes, lighting, fog). No libraries.
- `js/data.js`: the Squeekchain feed, round clock and round measurement.
- `js/hub.js`: the solar system. `js/game.js`: Squeek Rally.
- `js/planets/*.js`: one file per planet.
- Progress, names, calls and scores are saved in the browser (localStorage) on your device only.

## Credits

Built by **KADAFERHIDUP**. Not affiliated with the Squeekchain team. Play money in Fintopia has no value.
