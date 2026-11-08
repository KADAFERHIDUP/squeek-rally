# Squeek Orbit

**Eight planets orbiting the WHEELY9000, all powered by Squeekchain's real hamster.**

Live: **https://orbit.kadaferhidup.my.id**

Squeektoshi runs on the WHEELY9000 and mines Squeek blocks on Squeekchain. Squeek Orbit is a single site shaped like a solar system: the sun is the wheel, spinning at Squeektoshi's live rpm, and each of the eight planets is one kind of Squeekchain build with its own mode. When the hamster runs, the whole system speeds up.

| # | Planet | Category | What you can do |
|---|---|---|---|
| 1 | **Rallyon** | Games & mods | **Squeek Rally**, a real-time 3D hamster-ball runner on a floating tile road. The road turns gold and Wheel Power boosts speed and score while the real wheel turns; every Squeek block mined while you play drops a block crystal. Menus: Play, Call round, Garage (4 skins to unlock), Leaderboard, How to play, Settings. |
| 2 | **Raidus** | Server games & bots | **Daily Boss Raid**: today's boss loses HP for every metre the hamster runs, and with the shared server the whole crowd cheers together (cheers only count while the real wheel turns, checked server-side). A **Wheel Saga** written from every on-chain round settlement, so everyone reads the same story, plus a ready-to-run **Discord bot**. |
| 3 | **Oraclea** | AI on the wheel | **Beat the AI**: a forecasting model in your browser calls the next round against you. **Wheel Painter**: a painting that grows from every live wheel reading and gets a star for every block. |
| 4 | **Broadcastia** | Stream companions & overlays | Transparent OBS overlays (compact, full, ticker, **audience poll**), a second-screen live view, and a **run-or-sleep poll** viewers vote on from their phones (`#vote`). The poll settles from the round's on-chain settlement and its live tally shows on stream. |
| 5 | **Vaultar** | Utilities for holders | Check any address (Squeeks, power, custody, merge state, best merges), then **connect your own wallet** to merge, deposit into staking and claim rewards. Non-custodial: transactions are prepared for your wallet, simulated with `eth_call` first, and signed only by you. |
| 6 | **Squeekhaven** | Apps for Squeek NFT holders | Look up any Squeek, name it, pin it to your showcase wall; verified-holder badge for Squeeks owned by your saved wallet. |
| 7 | **Fintopia** | SqueekFi | Staking-share calculator from the Proof of Squeek formulas and live network totals, plus a play-money market on the next round. |
| 8 | **Evolvia** | Dynamic NFTs | *Squeektoshi's Echo*, a creature whose stage, fur, aura and relics evolve with the hamster; exports ERC-721 style metadata. |

## Squeekchain data

Everything comes from the public, read-only API at `https://api.squeekchain.com/v1` (Sepolia), called straight from the browser. No keys. The optional shared server (below) adds the multiplayer parts.

| Endpoint | Used for |
|---|---|
| `/status` | `measurement.coreStatus`, `rpmMilli`, `speedMmPerSecond`, `distanceMm` (daily, 12:00 to 12:00 UTC), `cumulativeWorkUnits`, `freshness`, `observedAt`; `builder.projected.blockHeight` / `blockProgress`; `builder.anchor.settledThroughRound` |
| `/economy/state` | SQK supply and cap, staking totals and parameters (`totalNftPower`, `totalSqkPower`, `sqkPerPower`, `referencePower`, all 18-decimal), `nft.mergesOpen`, and the contract addresses Vaultar uses (`components.collection.address`, `components.staking.address`, cross-checked against `components.staking.dependencies.collection` and `capabilities.mining.staking`) |
| `/settlements?range=24h` | `recentSettlements[]`: the on-chain result of each round (`settledThroughRound`, `workAdded`, `transactionHash`, completed blocks). Settles every call, duel, bet and poll, and writes the saga |
| `/events` | the on-chain ticker on the home screen |
| `/measurement/stats?range=7d` | 7-day wheel statistics |
| `/accounts/{address}`, `/squeeks/{id}` | Vaultar and Squeekhaven lookups |

Rounds follow the official schedule: 600 seconds each from genesis `1793735400`, so `round = floor((t − genesis) / 600) + 1` (checked against real settlements: the settlement mined at 07:40:36 UTC settles round 503, the round that ended at 07:40:00).

**Calls settle from the chain, not from the open tab.** Each settlement covers rounds `(previousSettledThroughRound, settledThroughRound]` with `workAdded` turns (one turn ≈ 0.88 m):

- one round in the range → that round's exact distance;
- zero work in the range → every round in it was 0 m;
- several rounds with work → the split is not published, so calls on those rounds are refunded, never guessed.

Close the tab after calling a round and the result is waiting when you come back. Rounds older than the API's window are fetched from the shared server's history (it records every settlement); without a server they are refunded. The page's own measurement of `cumulativeWorkUnits` is only a fallback when the settlement feed is down for more than three minutes.

## Vaultar transactions

| Action | Call | To |
|---|---|---|
| Merge two Squeeks in your wallet | `merge(uint256 keep, uint256 burn)` | Squeek collection |
| Merge two staked Squeeks | `mergeDeposited(address collection, uint256 keep, uint256 burn)` | Staking |
| Deposit one Squeek | `safeTransferFrom(address you, address staking, uint256 id)` | Squeek collection |
| Deposit several | `setApprovalForAll(address staking, true)` once, then `deposit(address collection, uint256[] ids)` in batches of 25 | Squeek collection, then Staking |
| Claim and restake rewards | `claimAndStake()` | Staking |

Rules Vaultar follows: the wallet must be on Sepolia (11155111, re-checked before every send); contract addresses come from `/economy/state` and must agree with each other; merges stay disabled while the collection reports `mergesOpen = false`; every call is simulated with `eth_call` and `eth_estimateGas` from your address, and the sign button only unlocks for the exact calldata that passed. Vaultar never asks for a private key or seed phrase. Selectors are keccak-256 of the signatures above and are checked in the test suite.

## Shared server (optional)

`server/` is a Cloudflare Worker with a D1 database (both on the free plan). With it:

- one **global Rallyon leaderboard** (all time and this week), with plausibility checks on every run;
- one **raid crowd**: cheers are counted server-side, only while the real wheel is turning, one per 20 s per player;
- the **audience poll** for Broadcastia viewers;
- a **round history** recorded every 5 minutes from `/settlements`, so calls placed days ago still settle.

Players are a random id plus a nickname they choose. No accounts, no wallets, no personal data. See [`server/README.md`](server/README.md) to deploy, then put the Worker URL in `js/config.js` (or in Rallyon → Settings, or add `?server=<url>` to any link). Without a server every planet still works on your own device.

If the API cannot be reached, the site switches to clearly labelled demo data.

## Run it

Static files, no build step:

```
npx serve .
```

Deploy the folder as-is to GitHub Pages, Netlify or Vercel. For OBS overlays, add a Browser Source pointing at `https://<your-site>/#overlay-compact` (or `#overlay-full`, `#overlay-ticker`, `#overlay-poll`). Broadcastia's builder adds `?server=` to the URL for you, because OBS keeps its own browser storage.

## Tests

```
node tests/abi.test.js        # selectors = keccak-256 of each signature, exact calldata
node tests/worker.test.mjs    # the shared server on Node's built-in SQLite with a mocked Squeekchain (Node 22+)
```

## Under the hood

- `js/engine.js`: a small WebGL2 renderer written for this project (instanced low-poly meshes, lighting, fog). No libraries.
- `js/data.js`: the Squeekchain feed, round clock, settlement ingest and round measurement.
- `js/wallet.js`: EIP-6963 / EIP-1193 wallet connection, ABI encoding, simulation and revert decoding.
- `js/net.js`: the client for the optional shared server. `server/worker.js`: the server.
- `js/hub.js`: the solar system. `js/game.js`: Squeek Rally.
- `js/planets/*.js`: one file per planet.
- Progress, names, calls and scores are saved in the browser (localStorage). Only runs, cheers and poll votes go to the shared server, under your nickname.

## Credits

Built by **KADAFERHIDUP**. Not affiliated with the Squeekchain team. Play money in Fintopia has no value.

squeekchain-project: 558d041b-ebb0-4b98-a795-df1db5bf35a4
