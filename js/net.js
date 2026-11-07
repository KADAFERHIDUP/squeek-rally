/* Squeek Orbit: client for the optional shared server (server/worker.js).
 * With a server, everyone shares one Rallyon leaderboard, one raid cheer count, one audience poll and a long
 * round history. Without one, every planet keeps working on this device only. */
'use strict';
window.SR = window.SR || {};

(() => {
  const SR = window.SR;
  const KEY = 'squeek-orbit-backend', ID_KEY = 'squeek-orbit-client';
  const TIMEOUT = 8000;

  const clean = u => {
    const s = String(u || '').trim().replace(/\/+$/, '');
    if (!s) return '';
    try {
      const x = new URL(s);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
      return x.protocol === 'https:' || (local && x.protocol === 'http:') ? x.origin + x.pathname.replace(/\/+$/, '') : '';
    } catch { return ''; }
  };
  let base = '';
  try {
    const q = new URLSearchParams(location.search).get('server');
    base = clean(q) || clean(localStorage.getItem(KEY)) || clean((window.SQUEEK_ORBIT_CONFIG || {}).backend);
  } catch { base = clean((window.SQUEEK_ORBIT_CONFIG || {}).backend); }

  let clientId = '';
  try { clientId = localStorage.getItem(ID_KEY) || ''; } catch { /* ignore */ }
  if (!/^[a-z0-9-]{16,40}$/.test(clientId)) {
    clientId = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')).toLowerCase();
    try { localStorage.setItem(ID_KEY, clientId); } catch { /* ignore */ }
  }

  const net = { status: base ? 'checking' : 'off', health: null };

  async function req(method, path, body) {
    if (!base) throw new Error('no shared server configured');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const r = await fetch(base + path, {
        method, signal: ctrl.signal, cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.error || `server answered ${r.status}`); e.status = r.status; throw e; }
      if (net.status !== 'ok') { net.status = 'ok'; changed(); }
      return j;
    } catch (e) {
      if (!e.status && net.status !== 'down') { net.status = 'down'; changed(); }
      throw e;
    } finally { clearTimeout(t); }
  }
  const subs = [];
  const changed = () => subs.forEach(f => { try { f(net.status); } catch (e) { console.error(e); } });

  async function check() {
    if (!base) { net.status = 'off'; changed(); return null; }
    try { net.health = await req('GET', '/v1/health'); return net.health; } catch { return null; }
  }

  SR.Net = {
    get base() { return base; },
    get clientId() { return clientId; },
    get status() { return net.status; },
    get health() { return net.health; },
    enabled: () => !!base && net.status !== 'down',
    configured: () => !!base,
    onChange: fn => subs.push(fn),
    clean,
    /** Point the app at a server (or '' to go back to device-only). Returns false for an unusable URL. */
    setBase(u) {
      const c = clean(u);
      if (u && !c) return false;
      base = c;
      try { c ? localStorage.setItem(KEY, c) : localStorage.removeItem(KEY); } catch { /* ignore */ }
      net.status = c ? 'checking' : 'off'; changed();
      check();
      return true;
    },
    check,
    async rounds(list) {
      const ids = [...new Set(list)].slice(0, 100).join(',');
      const j = await req('GET', `/v1/rounds?ids=${ids}`);
      return Array.isArray(j.rounds) ? j.rounds : [];
    },
    history: (limit = 300) => req('GET', `/v1/rounds?limit=${limit}`).then(j => Array.isArray(j.rounds) ? j.rounds : []),
    leaderboard: (period = 'all') => req('GET', `/v1/leaderboard?period=${period === 'week' ? 'week' : 'all'}&limit=20`),
    submitRun: (run, name) => req('POST', '/v1/runs', { client: clientId, name, ...run }),
    raid: () => req('GET', `/v1/raid?client=${clientId}`),
    cheer: name => req('POST', '/v1/raid/cheer', { client: clientId, name }),
    poll: () => req('GET', `/v1/poll?client=${clientId}`),
    vote: (round, choice) => req('POST', '/v1/poll/vote', { client: clientId, round, choice }),
  };

  check();
  setInterval(() => { if (base && net.status === 'down') check(); }, 60000);
})();
