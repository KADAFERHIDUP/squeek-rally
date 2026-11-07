/* Squeek Orbit shared server: a Cloudflare Worker + D1.
 *
 * Gives every visitor the same world:
 *   GET  /v1/health                 server and round-history status
 *   GET  /v1/rounds?ids=1,2 | ?from=&to= | ?limit=   on-chain round results recorded from Squeekchain /settlements
 *   GET  /v1/leaderboard?period=all|week&limit=20    best Rallyon run per player
 *   POST /v1/runs                   { client, name, score, distanceM, seeds, coins, gems, durationS, multiplier, skin }
 *   GET  /v1/raid?client=           today's shared boss raid cheers (days run 12:00 to 12:00 UTC)
 *   POST /v1/raid/cheer             { client, name }  only counts while the real wheel is turning (checked here, not in the browser)
 *   GET  /v1/poll?client=           audience poll for the next round: will Squeektoshi run (≥ 5 m) or sleep?
 *   POST /v1/poll/vote              { client, round, choice: "run" | "sleep" }
 *
 * A cron (every 5 minutes) copies /settlements into D1, so calls placed days ago can still be settled
 * after the public API's window of recent settlements has moved on.
 *
 * No accounts, no wallets, no personal data: a player is a random client id plus a nickname they choose.
 */

const SQUEEK = 'https://api.squeekchain.com/v1';
const GENESIS = 1793735400;
const ROUND_SECONDS = 600;
const METRES_PER_WORK = 0.88;
const SLEEP_BELOW_M = 5;
const CHEER_COOLDOWN_MS = 20000;

const roundAt = tSec => Math.floor((tSec - GENESIS) / ROUND_SECONDS) + 1;
const dayKey = (ms = Date.now()) => new Date(ms - 12 * 3600 * 1000).toISOString().slice(0, 10);
const CLIENT_RE = /^[a-z0-9-]{16,40}$/;
const NAME_RE = /^[A-Za-z0-9 _.\-]{3,20}$/;
const SKINS = new Set(['classic', 'sapphire', 'night', 'genesis']);

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ---------------------------------------------------------------- http helpers
function cors(req, env) {
  const origin = req.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (req.method === 'GET' || req.method === 'OPTIONS') h['Access-Control-Allow-Origin'] = origin && (allowed.includes(origin) || !allowed.length) ? origin : '*';
  else if (origin && (allowed.includes(origin) || !allowed.length)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

async function body(req) {
  const text = await req.text();
  if (text.length > 2048) throw new HttpError(413, 'body too large');
  try { const v = JSON.parse(text); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* fall through */ }
  throw new HttpError(400, 'expected a JSON object');
}
const int = (v, lo, hi, field) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(422, `${field} must be an integer from ${lo} to ${hi}`);
  return n;
};
function client(v) { if (typeof v !== 'string' || !CLIENT_RE.test(v)) throw new HttpError(422, 'client must be 16–40 characters of a–z, 0–9 or -'); return v; }
function nickname(v) {
  if (typeof v !== 'string') throw new HttpError(422, 'name is required');
  const n = v.trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(n)) throw new HttpError(422, 'name must be 3–20 letters, numbers, spaces, _ . or -');
  return n;
}

/** Fixed-window rate limit kept in D1: at most `limit` hits per `windowSec` for a key. */
async function limit(env, key, max, windowSec) {
  const win = Math.floor(Date.now() / 1000 / windowSec);
  const row = await env.DB.prepare(
    'INSERT INTO hits (key, win, count) VALUES (?1, ?2, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN win = ?2 THEN count + 1 ELSE 1 END, win = ?2 RETURNING count'
  ).bind(key, win).first();
  if (row && row.count > max) throw new HttpError(429, 'slow down');
}
const ipOf = req => req.headers.get('CF-Connecting-IP') || 'unknown';

// ---------------------------------------------------------------- Squeekchain reads
async function squeek(path) {
  const r = await fetch(SQUEEK + path, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 5 } });
  if (!r.ok) throw new HttpError(502, `Squeekchain ${path} answered ${r.status}`);
  return r.json();
}

/** The wheel's state, at most 8 s old. Cheers are only accepted while it turns. */
async function wheel(env) {
  const row = await env.DB.prepare('SELECT running, speed, today_m, fetched_at FROM wheel WHERE id = 1').first();
  if (row && Date.now() - row.fetched_at < 8000) return { running: !!row.running, speed: row.speed, todayM: row.today_m };
  const j = await squeek('/status');
  const m = j.measurement || {};
  const speed = (Number(m.speedMmPerSecond) || 0) / 1000;
  const running = String(m.coreStatus || '').toUpperCase() === 'SPINNING' || speed > 0.02;
  const todayM = m.distanceMm === undefined || m.distanceMm === null ? null : Number(m.distanceMm) / 1000;
  await env.DB.prepare('INSERT INTO wheel (id, running, speed, today_m, fetched_at) VALUES (1, ?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET running = ?1, speed = ?2, today_m = ?3, fetched_at = ?4')
    .bind(running ? 1 : 0, speed, todayM, Date.now()).run();
  return { running, speed, todayM };
}

/** Copy recent settlements into D1. Same splitting rule as the browser: one round per settlement is exact,
 *  a zero-work range is zero for every round in it, anything else is stored as unknown (NULL). */
async function record(env) {
  const j = await squeek('/settlements?range=24h');
  const list = Array.isArray(j.recentSettlements) ? j.recentSettlements : [];
  const stmts = [];
  const now = Date.now();
  for (const x of list) {
    const prev = Number(x.previousSettledThroughRound), thr = Number(x.settledThroughRound), work = Number(x.workAdded);
    if (!Number.isInteger(prev) || !Number.isInteger(thr) || thr <= prev || !Number.isFinite(work)) continue;
    const at = Date.parse(x.blockTimestamp) || null;
    const tx = typeof x.transactionHash === 'string' ? x.transactionHash.slice(0, 80) : null;
    for (let r = Math.max(prev + 1, thr - 499); r <= thr; r++) {
      const w = thr - prev === 1 ? work : work === 0 ? 0 : null;
      stmts.push(env.DB.prepare('INSERT INTO rounds (round, work, tx, settled_at, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(round) DO UPDATE SET work = COALESCE(rounds.work, excluded.work), tx = COALESCE(rounds.tx, excluded.tx)')
        .bind(r, w, tx, at, now));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

// ---------------------------------------------------------------- routes
async function health(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n, MAX(round) AS latest, MIN(round) AS oldest FROM rounds').first();
  return { ok: true, rounds: r.n, latestRound: r.latest, oldestRound: r.oldest, currentRound: roundAt(Date.now() / 1000), day: dayKey() };
}

async function rounds(env, url) {
  const ids = url.searchParams.get('ids');
  let res;
  if (ids) {
    const list = [...new Set(ids.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 100);
    if (!list.length) return { rounds: [] };
    res = await env.DB.prepare(`SELECT round, work, tx, settled_at FROM rounds WHERE round IN (${list.map(() => '?').join(',')}) ORDER BY round`).bind(...list).all();
  } else {
    const lim = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
    const from = Number(url.searchParams.get('from')) || 0, to = Number(url.searchParams.get('to')) || 1e9;
    res = await env.DB.prepare('SELECT round, work, tx, settled_at FROM rounds WHERE round BETWEEN ?1 AND ?2 ORDER BY round DESC LIMIT ?3').bind(from, to, lim).all();
  }
  return { rounds: res.results.map(r => ({ round: r.round, work: r.work, distanceM: r.work === null ? null : Math.round(r.work * METRES_PER_WORK), tx: r.tx, at: r.settled_at })) };
}

async function leaderboard(env, url) {
  const week = url.searchParams.get('period') === 'week';
  const lim = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const since = week ? Date.now() - 7 * 86400000 : 0;
  const res = await env.DB.prepare(
    `SELECT r.name, r.score, r.distance, r.seeds, r.gems, r.skin, r.at FROM runs r
     JOIN (SELECT client, MAX(score) AS best FROM runs WHERE at >= ?1 GROUP BY client) b ON b.client = r.client AND b.best = r.score
     WHERE r.at >= ?1 GROUP BY r.client ORDER BY r.score DESC LIMIT ?2`
  ).bind(since, lim).all();
  const total = await env.DB.prepare('SELECT COUNT(DISTINCT client) AS players, COUNT(*) AS runs FROM runs WHERE at >= ?1').bind(since).first();
  return { period: week ? 'week' : 'all', players: total.players, runs: total.runs, top: res.results.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, distanceM: r.distance, seeds: r.seeds, gems: r.gems, skin: r.skin, at: r.at })) };
}

/** Rallyon runs are simulated in the browser, so the server can only check that a run is physically possible
 *  for the game: top speed, how much score each pickup is worth and how often blocks are mined. */
function plausible(run) {
  const maxSpeed = 34;                                  // m/s: base 24 × the strongest wheel boost (1.33)
  if (run.distanceM > run.durationS * maxSpeed + 60) return 'distance is faster than the ball can roll';
  if (run.seeds > run.distanceM / 2 + 10) return 'more seeds than the road can hold';
  if (run.coins > run.distanceM / 8 + 10) return 'more coins than the road can hold';
  if (run.gems > run.durationS / 30 + 3) return 'more block crystals than blocks mined';
  const m = run.multiplier, wheelMax = 2.5;
  const ceiling = m * (run.distanceM * wheelMax * 0.6 + run.seeds * 25 * wheelMax + run.coins * 200 + run.gems * 1500) * 1.05 + 100;
  if (run.score > ceiling) return 'score is higher than the pickups allow';
  return null;
}

async function submitRun(req, env) {
  const b = await body(req);
  const run = {
    client: client(b.client), name: nickname(b.name),
    score: int(b.score, 0, 50_000_000, 'score'), distanceM: int(b.distanceM, 0, 200_000, 'distanceM'),
    seeds: int(b.seeds, 0, 100_000, 'seeds'), coins: int(b.coins, 0, 100_000, 'coins'), gems: int(b.gems, 0, 1000, 'gems'),
    durationS: int(b.durationS, 3, 7200, 'durationS'), multiplier: int(b.multiplier ?? 1, 1, 4, 'multiplier'),
    skin: SKINS.has(b.skin) ? b.skin : 'classic',
  };
  if (![1, 2, 4].includes(run.multiplier)) throw new HttpError(422, 'multiplier must be 1, 2 or 4');
  const bad = plausible(run);
  if (bad) throw new HttpError(422, `run rejected: ${bad}`);
  await limit(env, `run:${run.client}`, 1, 10);
  await limit(env, `run-ip:${ipOf(req)}`, 40, 3600);
  await env.DB.prepare('INSERT INTO runs (client, name, score, distance, seeds, coins, gems, duration, multiplier, skin, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)')
    .bind(run.client, run.name, run.score, run.distanceM, run.seeds, run.coins, run.gems, run.durationS, run.multiplier, run.skin, Date.now()).run();
  const rank = await env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM (SELECT client, MAX(score) AS best FROM runs GROUP BY client) WHERE best > ?1').bind(run.score).first();
  return { ok: true, rank: rank.rank };
}

async function raid(env, url) {
  const day = dayKey();
  const tot = await env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS cheers, COUNT(*) AS cheerers FROM cheers WHERE day = ?1').bind(day).first();
  const top = await env.DB.prepare('SELECT name, count FROM cheers WHERE day = ?1 ORDER BY count DESC, last_at ASC LIMIT 10').bind(day).all();
  const c = url.searchParams.get('client');
  const mine = c && CLIENT_RE.test(c) ? await env.DB.prepare('SELECT count, last_at FROM cheers WHERE day = ?1 AND client = ?2').bind(day, c).first() : null;
  return { day, cheers: tot.cheers, cheerers: tot.cheerers, top: top.results, mine: mine ? mine.count : 0, nextAt: mine ? mine.last_at + CHEER_COOLDOWN_MS : 0 };
}

async function cheer(req, env) {
  const b = await body(req);
  const id = client(b.client), name = nickname(b.name);
  await limit(env, `cheer-ip:${ipOf(req)}`, 120, 3600);
  const w = await wheel(env);
  if (!w.running) throw new HttpError(409, 'Squeektoshi is resting: cheers only count while the wheel turns');
  const day = dayKey(), now = Date.now();
  const row = await env.DB.prepare('SELECT last_at FROM cheers WHERE day = ?1 AND client = ?2').bind(day, id).first();
  if (row && now - row.last_at < CHEER_COOLDOWN_MS) throw new HttpError(429, `cheer again in ${Math.ceil((row.last_at + CHEER_COOLDOWN_MS - now) / 1000)} s`);
  await env.DB.prepare('INSERT INTO cheers (day, client, name, count, last_at) VALUES (?1, ?2, ?3, 1, ?4) ON CONFLICT(day, client) DO UPDATE SET count = count + 1, last_at = ?4, name = ?3')
    .bind(day, id, name, now).run();
  return raid(env, new URL(`https://x/?client=${id}`));
}

async function tally(env, round) {
  const r = await env.DB.prepare("SELECT SUM(choice = 'run') AS run, SUM(choice = 'sleep') AS sleep FROM votes WHERE round = ?1").bind(round).first();
  return { run: r.run || 0, sleep: r.sleep || 0 };
}
async function poll(env, url) {
  const now = Date.now() / 1000, open = roundAt(now) + 1;
  const c = url.searchParams.get('client');
  const mine = c && CLIENT_RE.test(c) ? await env.DB.prepare('SELECT choice FROM votes WHERE round = ?1 AND client = ?2').bind(open, c).first() : null;
  // the latest poll whose round has an on-chain result
  const last = await env.DB.prepare('SELECT v.round AS round, r.work AS work FROM (SELECT DISTINCT round FROM votes WHERE round < ?1) v JOIN rounds r ON r.round = v.round WHERE r.work IS NOT NULL ORDER BY v.round DESC LIMIT 1').bind(open).first();
  let result = null;
  if (last) {
    const t = await tally(env, last.round), d = Math.round(last.work * METRES_PER_WORK);
    const actual = d >= SLEEP_BELOW_M ? 'run' : 'sleep', crowd = t.run === t.sleep ? null : t.run > t.sleep ? 'run' : 'sleep';
    result = { round: last.round, ...t, distanceM: d, actual, crowdRight: crowd === null ? null : crowd === actual };
  }
  return { question: `Round #${open}: will Squeektoshi run (≥ ${SLEEP_BELOW_M} m) or sleep?`, open: { round: open, closesAt: (GENESIS + (open - 1) * ROUND_SECONDS) * 1000, ...(await tally(env, open)), mine: mine ? mine.choice : null }, last: result };
}
async function vote(req, env) {
  const b = await body(req);
  const id = client(b.client), open = roundAt(Date.now() / 1000) + 1;
  if (Number(b.round) !== open) throw new HttpError(409, `voting is open for round #${open} only`);
  if (b.choice !== 'run' && b.choice !== 'sleep') throw new HttpError(422, 'choice must be "run" or "sleep"');
  await limit(env, `vote-ip:${ipOf(req)}`, 60, 600);
  await env.DB.prepare('INSERT INTO votes (round, client, choice, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(round, client) DO UPDATE SET choice = ?3, at = ?4')
    .bind(open, id, b.choice, Date.now()).run();
  return poll(env, new URL(`https://x/?client=${id}`));
}

const ROUTES = {
  'GET /v1/health': (req, env) => health(env),
  'GET /v1/rounds': (req, env, url) => rounds(env, url),
  'GET /v1/leaderboard': (req, env, url) => leaderboard(env, url),
  'POST /v1/runs': (req, env) => submitRun(req, env),
  'GET /v1/raid': (req, env, url) => raid(env, url),
  'POST /v1/raid/cheer': (req, env) => cheer(req, env),
  'GET /v1/poll': (req, env, url) => poll(env, url),
  'POST /v1/poll/vote': (req, env) => vote(req, env),
};

export default {
  async fetch(req, env, ctx) {
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(req.url);
    const route = ROUTES[`${req.method} ${url.pathname.replace(/\/+$/, '')}`];
    if (!route) return json({ error: 'not found' }, 404, headers);
    if (req.method === 'POST' && !headers['Access-Control-Allow-Origin'] && req.headers.get('Origin')) return json({ error: 'origin not allowed' }, 403, headers);
    try {
      // keep round history fresh even if the cron has not fired yet
      if (url.pathname.startsWith('/v1/rounds') || url.pathname.startsWith('/v1/poll')) {
        const last = await env.DB.prepare('SELECT MAX(recorded_at) AS t FROM rounds').first();
        if (!last || !last.t || Date.now() - last.t > 300000) ctx.waitUntil(record(env).catch(() => 0));
      }
      return json(await route(req, env, url), 200, headers);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ error: status === 500 ? 'server error' : e.message }, status, headers);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(record(env)); },
};

export { plausible, roundAt, dayKey };
