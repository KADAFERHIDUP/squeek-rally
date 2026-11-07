// Runs server/worker.js on node:sqlite (a D1 stand-in) with a mocked Squeekchain API.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const W = (await import('../server/worker.js')).default;

// ---- D1 shim over node:sqlite
const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
const norm = a => a.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const conv = sql => sql.replace(/\?(\d+)/g, '?$1');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.sql, a); }
  _p() { return db.prepare(this.sql); }
  async first() { const r = this._p().get(...norm(this.args)); return r ? { ...r } : null; }
  async all() { return { results: this._p().all(...norm(this.args)).map(r => ({ ...r })) }; }
  async run() { const r = this._p().run(...norm(this.args)); return { meta: { changes: r.changes } }; } }
const env = { DB: { prepare: s => new Stmt(conv(s)), batch: async st => { for (const s of st) await s.run(); } }, ALLOWED_ORIGINS: 'https://kadaferhidup.github.io' };
const ctx = { waitUntil: p => p };

// ---- mock Squeekchain
let spinning = true;
const now = Date.now() / 1000, G = 1793735400, cur = Math.floor((now - G) / 600) + 1;
globalThis.fetch = async (u) => {
  const path = String(u).replace('https://api.squeekchain.com/v1', '');
  if (path === '/status') return new Response(JSON.stringify({ measurement: { coreStatus: spinning ? 'SPINNING' : 'IDLE', speedMmPerSecond: spinning ? '700' : '0', distanceMm: '1500000' } }));
  if (path.startsWith('/settlements')) return new Response(JSON.stringify({ recentSettlements: [
    { previousSettledThroughRound: String(cur - 2), settledThroughRound: String(cur - 1), activeRoundCount: '1', workAdded: '250', transactionHash: '0xaa', blockTimestamp: new Date().toISOString() },
    { previousSettledThroughRound: String(cur - 3), settledThroughRound: String(cur - 2), activeRoundCount: '1', workAdded: '3', transactionHash: '0xbb', blockTimestamp: new Date().toISOString() },
    { previousSettledThroughRound: String(cur - 8), settledThroughRound: String(cur - 3), activeRoundCount: '0', workAdded: '0', transactionHash: '0xcc', blockTimestamp: new Date().toISOString() },
    { previousSettledThroughRound: String(cur - 11), settledThroughRound: String(cur - 8), activeRoundCount: '2', workAdded: '90', transactionHash: '0xdd', blockTimestamp: new Date().toISOString() },
  ] }));
  return new Response('{}', { status: 404 });
};

const call = async (method, path, body, origin = 'https://kadaferhidup.github.io', ip = '1.1.1.1') => {
  const r = await W.fetch(new Request('https://w.example' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { Origin: origin, 'CF-Connecting-IP': ip } }), env, ctx);
  const t = await r.text(); return { status: r.status, j: t ? JSON.parse(t) : null, h: r.headers };
};

// cron
{ let pr; await W.scheduled({}, env, { waitUntil: p => { pr = p; } }); console.log("recorded", await pr); }
let r = await call('GET', '/v1/health');
assert.equal(r.status, 200); assert.equal(r.j.latestRound, cur - 1); console.log('health', r.j);
r = await call('GET', `/v1/rounds?ids=${cur - 1},${cur - 2},${cur - 5},${cur - 9},99`);
const by = Object.fromEntries(r.j.rounds.map(x => [x.round, x]));
assert.equal(by[cur - 1].work, 250); assert.equal(by[cur - 1].distanceM, 220);
assert.equal(by[cur - 2].work, 3); assert.equal(by[cur - 5].work, 0); assert.equal(by[cur - 9].work, null);
console.log('rounds ok', r.j.rounds.length);

// runs
const A = 'aaaaaaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbbbbbb';
const run = { client: A, name: 'KADAFERHIDUP', score: 9000, distanceM: 1200, seeds: 120, coins: 4, gems: 0, durationS: 60, multiplier: 1, skin: 'classic' };
r = await call('POST', '/v1/runs', run); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.rank, 1);
r = await call('POST', '/v1/runs', { ...run, score: 9500 }); assert.equal(r.status, 429, 'per-client rate limit');
r = await call('POST', '/v1/runs', { ...run, client: B, name: 'Hamster-X1', distanceM: 99999, durationS: 30 }); assert.equal(r.status, 422); console.log('reject:', r.j.error);
r = await call('POST', '/v1/runs', { ...run, client: B, name: 'Hamster-X1', score: 9_000_000 }); assert.equal(r.status, 422); console.log('reject:', r.j.error);
r = await call('POST', '/v1/runs', { ...run, client: B, name: '<script>' }); assert.equal(r.status, 422);
r = await call('POST', '/v1/runs', { ...run, client: B, name: 'Hamster-X1', score: 12000, multiplier: 2 }); assert.equal(r.status, 200); assert.equal(r.j.rank, 1);
r = await call('POST', '/v1/runs', { ...run, client: B }, 'https://evil.example'); assert.equal(r.status, 403);
r = await call('GET', '/v1/leaderboard'); assert.deepEqual(r.j.top.map(x => x.name), ['Hamster-X1', 'KADAFERHIDUP']); assert.equal(r.j.players, 2);
console.log('board', r.j.top.map(x => `${x.rank}.${x.name} ${x.score}`).join(' '));

// raid cheers
r = await call('POST', '/v1/raid/cheer', { client: A, name: 'KADAFERHIDUP' }); assert.equal(r.status, 200); assert.equal(r.j.cheers, 1);
r = await call('POST', '/v1/raid/cheer', { client: A, name: 'KADAFERHIDUP' }); assert.equal(r.status, 429); console.log('cooldown:', r.j.error);
r = await call('POST', '/v1/raid/cheer', { client: B, name: 'Hamster-X1' }); assert.equal(r.j.cheers, 2); assert.equal(r.j.cheerers, 2);
spinning = false; db.exec('UPDATE wheel SET fetched_at = 0');
r = await call('POST', '/v1/raid/cheer', { client: 'cccccccccccccccccccc', name: 'Hamster-C' }); assert.equal(r.status, 409); console.log('resting:', r.j.error);
r = await call('GET', '/v1/raid?client=' + A); assert.equal(r.j.mine, 1);

// poll
r = await call('GET', '/v1/poll'); const open = r.j.open.round; assert.equal(open, cur + 1);
r = await call('POST', '/v1/poll/vote', { client: A, round: open, choice: 'run' }); assert.equal(r.j.open.run, 1); assert.equal(r.j.open.mine, 'run');
r = await call('POST', '/v1/poll/vote', { client: A, round: open, choice: 'sleep' }); assert.equal(r.j.open.run, 0); assert.equal(r.j.open.sleep, 1);
r = await call('POST', '/v1/poll/vote', { client: B, round: open - 3, choice: 'run' }); assert.equal(r.status, 409);
// a past poll with an on-chain result
db.prepare('INSERT INTO votes VALUES (?, ?, ?, ?)').run(cur - 1, A, 'run', Date.now());
db.prepare('INSERT INTO votes VALUES (?, ?, ?, ?)').run(cur - 1, B, 'sleep', Date.now());
db.prepare('INSERT INTO votes VALUES (?, ?, ?, ?)').run(cur - 1, 'cccccccccccccccccccc', 'run', Date.now());
r = await call('GET', '/v1/poll'); assert.equal(r.j.last.round, cur - 1); assert.equal(r.j.last.actual, 'run'); assert.equal(r.j.last.crowdRight, true);
console.log('poll', JSON.stringify(r.j));
r = await call('GET', '/v1/nope'); assert.equal(r.status, 404);
r = await call('OPTIONS', '/v1/runs'); assert.equal(r.status, 204);
console.log('ALL WORKER TESTS PASSED');
