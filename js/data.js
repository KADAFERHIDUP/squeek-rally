/* Squeek Rally: Squeekchain data feed.
 *
 * Public, read-only API (Sepolia), CORS open, no key: https://api.squeekchain.com/v1
 *   /status             measurement.{coreStatus, freshness, rpmMilli, speedMmPerSecond, distanceMm, cumulativeWorkUnits, observedAt}
 *                       builder.anchor.{blockHeight, blockProgress, settledThroughRound}, builder.projected.{blockHeight, blockProgress}
 *   /economy/state      asset.decimals, supply.{liveSupplyBaseUnits, capBaseUnits}, staking.totalStakedBaseUnits, nft.live, lifecycle.{currentRound, stage}
 *   /events             recent on-chain activity (settlements, claims, stakes, merges)
 *   /measurement/stats  7-day wheel statistics
 *   /settlements        recentSettlements[] {previousSettledThroughRound, settledThroughRound, activeRoundCount, workAdded,
 *                       transactionHash, blockTimestamp, confirmationStatus}: the on-chain record of each round's work.
 *
 * Round calls, duels and market bets are settled from /settlements, so a player can close the tab and still get
 * the result when they come back. The page's own measurement of the work counter is only a fallback for when the
 * settlement feed cannot be reached.
 *
 * Rounds last 600 s from genesis 1793735400 (docs.squeekchain.com): round = floor((t - genesis) / 600) + 1.
 * One work unit is one turn of the wheel, about 0.88 m.
 */
'use strict';
window.SR = window.SR || {};

(() => {
  const SR = window.SR;
  const API = 'https://api.squeekchain.com/v1';
  const GENESIS = 1793735400;
  const ROUND_SECONDS = 600;
  const METRES_PER_WORK = 0.88;
  const TIMEOUT = 8000;

  const listeners = {};
  const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  const emit = (ev, payload) => (listeners[ev] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });

  const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const pick = (...v) => v.find(x => x !== undefined && x !== null && x !== '');

  /** Exact decimal formatting of large on-chain integers (strings) without losing precision. */
  function formatUnits(raw, decimals = 18, maxFraction = 0) {
    if (raw === null || raw === undefined) return null;
    try {
      const v = BigInt(String(raw));
      const base = 10n ** BigInt(decimals);
      const whole = v / base;
      let s = whole.toLocaleString('en-US');
      if (maxFraction > 0) {
        const frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFraction);
        if (Number(frac) > 0) s += '.' + frac;
      }
      return s;
    } catch { return null; }
  }
  function ratio(a, b) {
    try {
      const x = BigInt(String(a)), y = BigInt(String(b));
      if (y === 0n) return null;
      return Number((x * 1000000n) / y) / 1000000;
    } catch { return null; }
  }

  const roundAt = tSec => Math.floor((tSec - GENESIS) / ROUND_SECONDS) + 1;
  const roundStart = r => GENESIS + (r - 1) * ROUND_SECONDS;

  const state = {
    mode: 'connecting',
    lastOk: 0,
    fails: 0,
    status: {
      running: false, coreStatus: null, freshness: null, rpm: 0, speed: 0, todayM: null,
      cumWork: null, blockHeight: null, blockProgress: null, settledThrough: null, observedAt: null,
    },
    economy: null,
    events: [],
    stats: null,
    rounds: [],                 // measured rounds { round, work, distanceM, complete }
    sample: null,               // { round, startWork, startAt, firstSeenSec }
    chain: { rounds: {}, through: null, oldest: null, fails: 0, lastOk: 0, summary: null, recent: [] },
    lastEmitted: null,          // highest round already announced with the 'round' event (persisted)
    raw: {},
  };

  try {
    const saved = JSON.parse(localStorage.getItem('squeek-rally-rounds') || '[]');
    if (Array.isArray(saved)) state.rounds = saved.slice(-200);
  } catch { /* no storage */ }
  const saveRounds = () => { try { localStorage.setItem('squeek-rally-rounds', JSON.stringify(state.rounds.slice(-200))); } catch { /* ignore */ } };
  const CHAIN_KEY = 'squeek-orbit-chain-rounds', LAST_KEY = 'squeek-orbit-last-round';
  try {
    const saved = JSON.parse(localStorage.getItem(CHAIN_KEY) || '{}');
    if (saved && typeof saved === 'object') state.chain.rounds = saved;
    const last = Number(localStorage.getItem(LAST_KEY));
    if (Number.isFinite(last) && last > 0) state.lastEmitted = last;
  } catch { /* no storage */ }
  function saveChain() {
    try {
      const keys = Object.keys(state.chain.rounds).map(Number).sort((a, b) => a - b);
      for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete state.chain.rounds[k];
      localStorage.setItem(CHAIN_KEY, JSON.stringify(state.chain.rounds));
      if (state.lastEmitted) localStorage.setItem(LAST_KEY, String(state.lastEmitted));
    } catch { /* ignore */ }
  }

  async function get(path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const r = await fetch(API + path, { signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // ------------------------------------------------------------ parsing
  function parseStatus(j) {
    const m = j.measurement || {};
    const anchor = (j.builder && j.builder.anchor) || {};
    const proj = (j.builder && j.builder.projected) || {};
    const speedMm = num(m.speedMmPerSecond);
    const core = m.coreStatus ? String(m.coreStatus).toUpperCase() : null;
    return {
      coreStatus: core,
      freshness: m.freshness || null,
      rpm: (num(m.rpmMilli) || 0) / 1000,
      speed: (speedMm || 0) / 1000,
      todayM: num(m.distanceMm) === null ? null : num(m.distanceMm) / 1000,
      cumWork: num(m.cumulativeWorkUnits),
      blockHeight: num(pick(proj.blockHeight, anchor.blockHeight)),
      blockProgress: num(pick(proj.blockProgress, anchor.blockProgress)),
      settledThrough: num(anchor.settledThroughRound),
      observedAt: m.observedAt ? Date.parse(m.observedAt) : null,
      running: core === 'SPINNING' || (speedMm || 0) > 20,
    };
  }

  function parseEconomy(j) {
    const decimals = num(j.asset && j.asset.decimals) ?? 18;
    const live = j.supply && j.supply.liveSupplyBaseUnits;
    const cap = j.supply && j.supply.capBaseUnits;
    return {
      symbol: (j.asset && j.asset.symbol) || 'SQK',
      decimals,
      live: formatUnits(live, decimals),
      cap: formatUnits(cap, decimals),
      liveRatio: ratio(live, cap),
      staked: formatUnits(j.staking && j.staking.totalStakedBaseUnits, decimals),
      nftLive: num(j.nft && j.nft.live),
      currentRound: num(j.lifecycle && j.lifecycle.currentRound),
      stage: (j.lifecycle && j.lifecycle.stage) || null,
      paused: Boolean(j.lifecycle && j.lifecycle.paused),
      chainId: num(j.chain && j.chain.chainId),
      totalNftPower: (j.staking && j.staking.totalNftPower) ?? null,
      totalSqkPower: (j.staking && j.staking.totalSqkPower) ?? null,
      stakedRaw: (j.staking && j.staking.totalStakedBaseUnits) ?? null,
      sqkPerPower: (j.staking && j.staking.sqkPerPower) ?? null,
      referencePower: (j.staking && j.staking.referencePower) ?? null,
      stakingPaused: Boolean(j.staking && j.staking.paused),
      mergesOpen: pick(j.nft && j.nft.mergesOpen, j.capabilities && j.capabilities.collection && j.capabilities.collection.mergesOpen, null),
      maxLevel: num(j.nft && j.nft.maximumLevel) ?? 10,
      contracts: contractsOf(j),
    };
  }

  /** Contract addresses as published by the API (components.<name>.address). Never hard-coded. */
  function contractsOf(j) {
    const c = j.components || {};
    const addr = x => (x && typeof x.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x.address)) ? x.address : null;
    const out = {
      core: addr(c.core), collection: addr(c.collection), token: addr(c.token), mining: addr(c.mining), staking: addr(c.staking),
      dispenser: addr(c.dispenser),
    };
    // cross-check: the staking contract must point at the same collection, and mining must name the same staking contract
    const dep = (c.staking && c.staking.dependencies) || {};
    const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
    const capStaking = j.capabilities && j.capabilities.mining && j.capabilities.mining.staking;
    out.consistent = !!(out.collection && out.staking && same(dep.collection, out.collection) && (!capStaking || same(capStaking, out.staking)));
    return out;
  }

  // ------------------------------------------------------------ holder lookups (read-only)
  function parseSqueek(j, idHint) {
    const x = j && (j.squeek || j.data || j);
    if (!x || typeof x !== 'object') return null;
    const meta = x.metadata || {};
    const custody = x.custody || {};
    const level = num(pick(x.level, meta.level));
    return {
      id: num(pick(x.tokenId, x.id, idHint)),
      level,
      power: num(pick(x.basePower, x.power)) ?? (level ? Math.round(1000 * Math.pow(2.2, level - 1)) : null),
      mergeState: pick(x.mergeState, x.merge && x.merge.state, null),
      nextMergeHeight: num(pick(x.nextMergeHeight, x.merge && x.merge.nextMergeHeight)),
      owner: pick(custody.owner, x.owner, null),
      depositor: pick(custody.depositor, null),
      burned: Boolean(custody.burned),
      name: pick(meta.name, x.name, idHint !== undefined ? `Squeek #${idHint}` : 'Squeek'),
      attributes: Array.isArray(meta.attributes) ? meta.attributes : [],
      image: typeof meta.imageDataUri === 'string' && meta.imageDataUri.startsWith('data:image/') ? meta.imageDataUri : null,
      coreBlockHeight: num(x.economy && x.economy.coreBlockHeight),
    };
  }
  function parseAccount(j) {
    const list = pick(j.squeeks, j.tokens, j.nfts, j.holdings, j.data && j.data.squeeks) || [];
    return {
      squeeks: Array.isArray(list) ? list.map(t => parseSqueek(t)).filter(Boolean) : [],
      claimable: pick(j.claimableBaseUnits, j.rewards && j.rewards.claimableBaseUnits, j.claimable, null),
      stakedSqk: pick(j.stakedBaseUnits, j.staking && j.staking.stakedBaseUnits, null),
      power: num(pick(j.power, j.totalPower, j.staking && j.staking.power)),
      coreBlockHeight: num(pick(j.coreBlockHeight, j.core && j.core.blockHeight, j.economy && j.economy.coreBlockHeight)),
      mergesOpen: pick(j.mergesOpen, j.economy && j.economy.mergesOpen, null),
    };
  }
  async function fetchSqueek(id) {
    if (state.mode === 'demo') return { demo: true, raw: null, squeek: demoSqueek(id) };
    const raw = await get('/squeeks/' + encodeURIComponent(id));
    return { demo: false, raw, squeek: parseSqueek(raw, id) };
  }
  async function fetchAccount(address) {
    if (state.mode === 'demo') return { demo: true, raw: null, account: { squeeks: [3, 41, 77, 108, 990].map(demoSqueek), claimable: '125400000000000000000', stakedSqk: null, power: 9640, coreBlockHeight: state.status.blockHeight, mergesOpen: true } };
    const raw = await get('/accounts/' + encodeURIComponent(address));
    return { demo: false, raw, account: parseAccount(raw) };
  }
  function demoSqueek(id) {
    const lvl = 1 + (id % 4);
    return { id, level: lvl, power: Math.round(1000 * Math.pow(2.2, lvl - 1)), mergeState: id % 3 ? 'ready' : 'cooldown', nextMergeHeight: id % 3 ? null : 1500 + id, owner: '0xdemo', depositor: null, burned: false, name: `Squeek #${id}`, attributes: [{ trait_type: 'Level', value: lvl }], image: null, coreBlockHeight: state.status.blockHeight };
  }

  function parseEvents(j) {
    const list = Array.isArray(j) ? j : pick(j.events, j.items, j.data, j.recent) || [];
    if (!Array.isArray(list)) return [];
    return list.slice(0, 12).map(e => {
      const type = String(pick(e.type, e.kind, e.eventType, e.category, e.name, 'event'));
      const at = pick(e.occurredAt, e.createdAt, e.timestamp, e.blockTimestamp, e.confirmedAt, null);
      const tx = pick(e.transactionHash, e.txHash, e.hash, null);
      const round = pick(e.round, e.settledThroughRound, e.lastRound, null);
      return { type, at: at ? Date.parse(at) || null : null, tx, round };
    });
  }

  function parseStats(j) {
    const s = pick(j.summary, j.totals, j) || {};
    return {
      distanceM: num(pick(s.observedDistanceMm, s.distanceMm)) === null ? null : num(pick(s.observedDistanceMm, s.distanceMm)) / 1000,
      work: num(pick(s.acceptedWorkUnits, s.workUnits)),
      settlements: num(s.settlementCount),
      activeDays: num(s.activeDayCount),
    };
  }

  // ------------------------------------------------------------ on-chain settlements
  /** Turn /settlements into per-round results. A settlement covers rounds (previousSettledThroughRound, settledThroughRound].
   *  One round in the range: exact. Zero work in the range: every round in it was 0. Otherwise the split between rounds
   *  is not published, so those rounds are marked unresolvable (calls on them are refunded, never guessed). */
  function parseSettlements(j) {
    const list = Array.isArray(j && j.recentSettlements) ? j.recentSettlements : [];
    const results = [];
    let through = null, oldest = null;
    for (const x of list) {
      const prev = num(x.previousSettledThroughRound), thr = num(x.settledThroughRound), work = num(x.workAdded);
      if (prev === null || thr === null || thr <= prev || work === null) continue;
      through = through === null ? thr : Math.max(through, thr);
      oldest = oldest === null ? prev + 1 : Math.min(oldest, prev + 1);
      const base = { source: 'chain', tx: x.transactionHash || null, at: x.blockTimestamp ? Date.parse(x.blockTimestamp) || null : null, confirmation: x.confirmationStatus || null };
      const blocks = num(x.completedBlockCount) || 0, lastBlock = num(x.lastCompletedBlock);
      if (thr - prev === 1) results.push({ ...base, round: thr, work, distanceM: Math.round(work * METRES_PER_WORK), complete: true, blocks, lastBlock });
      else if (work === 0) for (let r = prev + 1; r <= thr && r - prev <= 500; r++) results.push({ ...base, round: r, work: 0, distanceM: 0, complete: true });
      else for (let r = prev + 1; r <= thr && r - prev <= 500; r++) results.push({ ...base, round: r, work: null, distanceM: null, complete: false, reason: 'shared settlement' });
    }
    return { results: results.sort((a, b) => a.round - b.round), through, oldest, summary: j && j.summary ? j.summary : null };
  }

  let pendingProvider = () => [];
  /** Record results, announce new rounds once ('round'), and offer every known result for settling ('settle'). */
  function ingest(results) {
    if (!results.length) return;
    const known = state.chain.rounds;
    for (const r of results) {
      const had = known[r.round];
      if (!had || (had.source !== 'chain' && r.source === 'chain') || (!had.complete && r.complete)) known[r.round] = r;
    }
    const sorted = results.map(r => known[r.round]).sort((a, b) => a.round - b.round);
    const top = sorted[sorted.length - 1].round;
    if (state.lastEmitted === null) state.lastEmitted = top - 1;  // first visit: announce only the latest round
    const fresh = sorted.filter(r => r.round > state.lastEmitted);
    if (fresh.length) state.lastEmitted = fresh[fresh.length - 1].round;
    fresh.slice(-12).forEach(r => emit('round', r));   // a long idle stretch is announced as its last 12 rounds
    saveChain();
    settlePending();
  }

  /** Offer results for every round something on this device is waiting on. Rounds that fell out of the
   *  settlement window (and are not in the shared server's history) are voided so stakes come back. */
  let fetchingHistory = false;
  async function settlePending() {
    const pending = [...new Set((pendingProvider() || []).map(Number).filter(Number.isFinite))];
    const thr = state.chain.through;
    if (!pending.length || thr === null) return;
    const missing = [];
    for (const r of pending) {
      if (r > thr) continue;
      const res = state.chain.rounds[r];
      if (res) emit('settle', res);
      else missing.push(r);
    }
    if (!missing.length) return;
    if (SR.Net && SR.Net.enabled() && !fetchingHistory) {
      fetchingHistory = true;
      try {
        const got = await SR.Net.rounds(missing);
        const add = got.map(x => ({ round: x.round, work: x.work, distanceM: x.work === null ? null : Math.round(x.work * METRES_PER_WORK), complete: x.work !== null, source: 'chain', tx: x.tx || null, at: x.at || null, reason: x.work === null ? 'shared settlement' : undefined }));
        if (add.length) { for (const a of add) state.chain.rounds[a.round] = a; saveChain(); add.forEach(a => emit('settle', a)); }
        const have = new Set(add.map(a => a.round));
        missing.splice(0, missing.length, ...missing.filter(r => !have.has(r)));
      } catch { /* server unavailable: fall through */ }
      fetchingHistory = false;
    }
    for (const r of missing) if (state.chain.oldest !== null && r < state.chain.oldest) emit('settle', { round: r, complete: false, source: 'expired', reason: 'outside the settlement window' });
  }

  /** Load the shared server's long round history (no announcements: these rounds are in the past). */
  async function seedHistory() {
    if (!SR.Net || !SR.Net.enabled()) return;
    try {
      const list = await SR.Net.history(300);
      let added = 0;
      for (const x of list) {
        if (state.chain.rounds[x.round] || x.work === null || x.work === undefined) continue;
        state.chain.rounds[x.round] = { round: x.round, work: x.work, distanceM: Math.round(x.work * METRES_PER_WORK), complete: true, source: 'chain', tx: x.tx || null, at: x.at || null };
        added++;
      }
      if (added) { saveChain(); emit('settlements', state.chain); settlePending(); }
    } catch { /* server optional */ }
  }

  // ------------------------------------------------------------ round measurement
  function trackRound(st, nowSec) {
    if (st.cumWork === null) return;
    const r = roundAt(nowSec);
    const s = state.sample;
    if (!s) {
      state.sample = { round: r, startWork: st.cumWork, firstSeenSec: nowSec };
      return;
    }
    if (r !== s.round) {
      const work = Math.max(0, st.cumWork - s.startWork);
      const complete = s.firstSeenSec - roundStart(s.round) <= 30 && r === s.round + 1;
      const result = { round: s.round, work, distanceM: Math.round(work * METRES_PER_WORK), complete, source: 'measured', reason: complete ? undefined : 'not watched from the start' };
      if (complete) { state.rounds.push(result); saveRounds(); }
      emit('measured', result);
      if (state.mode === 'demo') ingestDemo(result);
      else if (complete) {
        // fallback only: if the settlement feed has not produced this round within 3 minutes, use the measurement
        setTimeout(() => {
          const healthy = Date.now() - state.chain.lastOk < 120000;
          if (!state.chain.rounds[result.round] && (!healthy || state.chain.through === null)) ingest([result]);
        }, 180000);
      }
      state.sample = { round: r, startWork: st.cumWork, firstSeenSec: nowSec };
    }
  }

  function applyStatus(st, nowSec) {
    const prevHeight = state.status.blockHeight;
    const wasRunning = state.status.running;
    state.status = st;
    trackRound(st, nowSec);
    if (prevHeight !== null && st.blockHeight !== null && st.blockHeight > prevHeight) {
      for (let h = prevHeight + 1; h <= st.blockHeight && h <= prevHeight + 5; h++) emit('block', { height: h });
    }
    if (wasRunning !== st.running) emit('wheel', st);
    emit('status', st);
  }

  // ------------------------------------------------------------ polling
  async function pollStatus() {
    if (state.mode === 'demo') return;
    try {
      const j = await get('/status');
      state.raw.status = j;
      state.fails = 0;
      state.lastOk = Date.now();
      if (state.mode !== 'live') { state.mode = 'live'; emit('mode', 'live'); }
      applyStatus(parseStatus(j), Date.now() / 1000);
    } catch (e) {
      state.fails++;
      if (state.mode === 'connecting' && state.fails >= 2) startDemo();
      else emit('mode', state.mode);
    }
  }
  async function pollEconomy() {
    if (state.mode === 'demo') return;
    try { const j = await get('/economy/state'); state.raw.economy = j; state.economy = parseEconomy(j); emit('economy', state.economy); } catch { /* keep last */ }
  }
  async function pollEvents() {
    if (state.mode === 'demo') return;
    try { const j = await get('/events?category=all&limit=10'); state.raw.events = j; state.events = parseEvents(j); emit('events', state.events); } catch { /* keep last */ }
  }
  async function pollSettlements() {
    if (state.mode === 'demo') return;
    try {
      const j = await get('/settlements?range=24h');
      state.raw.settlements = j;
      const p = parseSettlements(j);
      state.chain.fails = 0; state.chain.lastOk = Date.now();
      if (p.through !== null) state.chain.through = Math.max(state.chain.through || 0, p.through);
      if (p.oldest !== null) state.chain.oldest = p.oldest;
      state.chain.summary = p.summary;
      state.chain.recent = p.results.slice(-12);
      ingest(p.results);
      emit('settlements', state.chain);
    } catch { state.chain.fails++; }
  }
  async function pollStats() {
    if (state.mode === 'demo') return;
    try { const j = await get('/measurement/stats?range=7d'); state.raw.stats = j; state.stats = parseStats(j); emit('stats', state.stats); } catch { /* keep last */ }
  }

  // ------------------------------------------------------------ demo feed (only when the API cannot be reached)
  const demo = { work: 13000, height: 1364, progress: 0.1, today: 1770, burst: 0, t: 0 };
  function startDemo() {
    state.mode = 'demo';
    emit('mode', 'demo');
    state.economy = { symbol: 'SQK', decimals: 18, live: '219,410,000', cap: '2,100,000,000', liveRatio: 0.1045, staked: '8,420,000', nftLive: 2481, currentRound: roundAt(Date.now() / 1000), stage: 'demo', paused: false, chainId: 11155111, totalNftPower: '2731400000000000000000000', totalSqkPower: '1840000000000000000000000', stakedRaw: null, sqkPerPower: '40000000000000000000', referencePower: '1000000000000000000000', stakingPaused: false, mergesOpen: true, maxLevel: 10, contracts: {} };
    state.stats = { distanceM: 18420, work: 20930, settlements: 1008, activeDays: 4 };
    state.events = [
      { type: 'settlement', at: Date.now() - 60000, tx: null, round: roundAt(Date.now() / 1000) - 1 },
      { type: 'merge', at: Date.now() - 240000, tx: null, round: null },
      { type: 'claim', at: Date.now() - 420000, tx: null, round: null },
    ];
    emit('economy', state.economy); emit('stats', state.stats); emit('events', state.events);
    setInterval(demoTick, 1000);
    demoTick();
  }
  function ingestDemo(result) {
    const r = { ...result, complete: true, source: 'chain', tx: null, at: Date.now(), work: result.work, distanceM: result.distanceM };
    state.chain.through = r.round; state.chain.oldest = state.chain.oldest ?? r.round; state.chain.lastOk = Date.now();
    ingest([r]);
    emit('settlements', state.chain);
  }
  function demoTick() {
    demo.t++;
    if (demo.burst <= 0 && Math.random() < 0.12) demo.burst = 6 + Math.floor(Math.random() * 20);
    const running = demo.burst > 0;
    if (running) demo.burst--;
    const speed = running ? 0.6 + Math.random() * 0.7 : 0;
    demo.work += speed / METRES_PER_WORK;
    demo.today += speed;
    demo.progress += speed * 0.02;
    if (demo.progress >= 1) { demo.progress -= 1; demo.height++; }
    const nowSec = Date.now() / 1000;
    applyStatus({
      coreStatus: running ? 'SPINNING' : 'IDLE', freshness: 'online', rpm: speed * 60 / 0.88, speed,
      todayM: demo.today, cumWork: Math.floor(demo.work), blockHeight: demo.height, blockProgress: Math.floor(demo.progress * 1e9),
      settledThrough: roundAt(nowSec) - 2, observedAt: Date.now(), running,
    }, nowSec);
  }

  function start() {
    pollStatus().then(() => { pollEconomy(); pollEvents(); pollStats(); pollSettlements().then(seedHistory); });
    setInterval(pollStatus, 4000);
    setInterval(pollSettlements, 45000);
    setInterval(pollEconomy, 30000);
    setInterval(pollEvents, 20000);
    setInterval(pollStats, 300000);
  }

  SR.Data = {
    API, GENESIS, ROUND_SECONDS, METRES_PER_WORK,
    state, on, start, roundAt, roundStart, formatUnits, ingest, settlePending, parseSettlements, contractsOf,
    setPendingProvider: fn => { pendingProvider = fn; },
    /** Every known round result, on-chain first, then this device's own measurements. */
    history() {
      const m = new Map();
      for (const r of state.rounds) if (r.complete) m.set(r.round, r);
      for (const r of Object.values(state.chain.rounds)) if (r.complete) m.set(r.round, r);
      return [...m.values()].sort((a, b) => a.round - b.round);
    },
    currentRound: () => roundAt(Date.now() / 1000),
    secondsLeft: () => { const now = Date.now() / 1000; return Math.max(0, roundStart(roundAt(now) + 1) - now); },
    parseStatus, parseEconomy, parseEvents, parseStats, parseSqueek, parseAccount, fetchSqueek, fetchAccount,
  };
})();
