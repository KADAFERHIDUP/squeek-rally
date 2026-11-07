/* Squeek Orbit: app shell. Hub, planet routing, shared profile, toasts and the live top bar. */
'use strict';
window.SR = window.SR || {};

(() => {
  const SR = window.SR;
  const $ = id => document.getElementById(id);

  const PLANETS = [
    { id: 'rally',    name: 'Rallyon',     category: 'Games & mods',               blurb: 'A 3D hamster-ball rally on a road paved by the real wheel. Call each round for combo boosts.', css: '#f2b33d', color: [0.98, 0.66, 0.2],  color2: [1, 0.84, 0.48],  size: 1.45, orbit: 10,  speed: 1.25, phase: 0.3, tilt: 0.6, ring: false, moons: 1 },
    { id: 'raid',     name: 'Raidus',      category: 'Server games & bots',        blurb: 'A daily boss raid the whole crowd cheers on, and a saga written from every on-chain round settlement.', css: '#ff6b6b', color: [0.92, 0.3, 0.32], color2: [1, 0.55, 0.5],   size: 1.2,  orbit: 13.6, speed: 1.05, phase: 1.4, tilt: 1.0, ring: false, moons: 2 },
    { id: 'oracle',   name: 'Oraclea',     category: 'AI on the wheel',            blurb: 'Beat the forecasting model at calling rounds, and watch a painting grow from every run.', css: '#b78cff', color: [0.6, 0.42, 1.0],  color2: [0.85, 0.75, 1],  size: 1.35, orbit: 17.2, speed: 0.9, phase: 2.6, tilt: 0.8, ring: true,  moons: 0 },
    { id: 'stream',   name: 'Broadcastia', category: 'Stream companions & overlays', blurb: 'OBS-ready overlays, a second screen, and an audience poll viewers vote on from their phones.', css: '#4fd1c5', color: [0.2, 0.78, 0.74], color2: [0.6, 1, 0.95],  size: 1.1,  orbit: 20.8, speed: 0.8, phase: 3.9, tilt: 1.2, ring: false, moons: 1 },
    { id: 'vault',    name: 'Vaultar',     category: 'Utilities for holders',      blurb: 'Connect your own wallet to merge, stake and claim: every transaction simulated first, signed only by you.', css: '#4f8cff', color: [0.3, 0.5, 1.0],   color2: [0.65, 0.78, 1],  size: 1.5,  orbit: 24.4, speed: 0.68, phase: 5.0, tilt: 0.7, ring: true,  moons: 2 },
    { id: 'showcase', name: 'Squeekhaven', category: 'Apps for Squeek NFT holders', blurb: 'Look up any Squeek, give it a name and pin it to your showcase wall.', css: '#ff9fd1', color: [1.0, 0.55, 0.78], color2: [1, 0.82, 0.92],  size: 1.15, orbit: 28,  speed: 0.58, phase: 0.9, tilt: 1.3, ring: false, moons: 1 },
    { id: 'fi',       name: 'Fintopia',    category: 'SqueekFi',                   blurb: 'Staking-share calculator from the live economy, plus a play-money market on the next round.', css: '#67d68f', color: [0.3, 0.8, 0.5],   color2: [0.7, 1, 0.8],    size: 1.3,  orbit: 31.6, speed: 0.5, phase: 2.1, tilt: 0.9, ring: true,  moons: 0 },
    { id: 'evolve',   name: 'Evolvia',     category: 'Dynamic NFTs',               blurb: 'A living Squeek whose body, colours and traits evolve with the hamster\'s distance and rounds.', css: '#ffd166', color: [1.0, 0.82, 0.38], color2: [1, 0.95, 0.75], size: 1.25, orbit: 35.2, speed: 0.44, phase: 4.4, tilt: 1.1, ring: false, moons: 3 },
  ];

  // ------------------------------------------------------------ profile (this device only)
  const KEY = 'squeek-orbit-profile';
  const defaults = {
    skin: 'classic', runs: [], best: 0, totalSeeds: 0, totalCoins: 0, totalGems: 0,
    calls: {}, correctCalls: 0, totalCalls: 0, boost: 1,
    settings: { sound: true, quality: 'high', shake: true },
    oracle: { you: 0, ai: 0, picks: {} }, raid: { cheers: 0, picks: {} }, names: {}, showcase: [], fi: { balance: 1000, bets: {} },
    vaultAddress: '', nickname: '',
  };
  let profile;
  try { profile = Object.assign(structuredClone(defaults), JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { profile = structuredClone(defaults); }
  profile.settings = Object.assign({}, defaults.settings, profile.settings);
  const saveProfile = () => { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* storage unavailable */ } };

  // ------------------------------------------------------------ helpers shared by planets
  let toastTimer = 0;
  function toast(text, kind = '') {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 3600);
  }
  const fmtM = m => (m === null || m === undefined) ? '–' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
  const fmtClock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Public handle for shared boards. Never the player's real name: a generated one unless they pick their own. */
  function nickname() {
    if (!profile.nickname) { profile.nickname = 'Hamster-' + Math.random().toString(36).slice(2, 6).toUpperCase(); saveProfile(); }
    return profile.nickname;
  }
  const why = r => r.reason ? r.reason : r.source === 'expired' ? 'outside the settlement window' : 'no exact result';
  const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };

  /** Round distance bands: Sleep / Jog / Run / Sprint, learned from measured rounds when there are enough. */
  function bands() {
    const d = SR.Data.history().slice(-300).map(r => r.distanceM).filter(v => v >= 5).sort((a, b) => a - b);
    if (d.length >= 6) {
      const q = p => d[Math.min(d.length - 1, Math.floor(p * d.length))];
      const b1 = Math.max(10, Math.round(q(1 / 3))), b2 = Math.max(b1 + 10, Math.round(q(2 / 3)));
      return { edges: [5, b1, b2], learned: d.length };
    }
    return { edges: [5, 150, 400], learned: 0 };
  }
  const BAND_NAMES = ['Sleep', 'Jog', 'Run', 'Sprint'];
  const bandOf = (m, e = bands().edges) => (m < e[0] ? 0 : m < e[1] ? 1 : m < e[2] ? 2 : 3);
  const bandRange = (i, e = bands().edges) => [`< ${e[0]} m`, `${e[0]}–${e[1]} m`, `${e[1]}–${e[2]} m`, `≥ ${e[2]} m`][i];

  // ------------------------------------------------------------ live top bar
  function updateChips() {
    const D = SR.Data, st = D.state.status;
    const wheel = st.cumWork === null && D.state.mode === 'connecting' ? '–' : st.running ? `Running ${st.speed.toFixed(2)} m/s` : 'Resting';
    for (const id of ['chip-wheel', 'p-wheel']) { const el = $(id); el.textContent = wheel; el.parentElement.classList.toggle('on', st.running); }
    const r = D.currentRound();
    $('chip-round').textContent = `#${r}`; $('p-round').textContent = `#${r}`;
    const left = fmtClock(D.secondsLeft());
    $('chip-clock').textContent = left; $('p-clock').textContent = left;
    $('chip-block').textContent = st.blockHeight === null ? '–' : `#${st.blockHeight.toLocaleString('en-US')}`;
  }
  function setFeed(mode) {
    const f = $('feed');
    f.dataset.state = mode;
    $('feed-label').textContent = mode === 'live' ? 'Live · Sepolia' : mode === 'demo' ? 'Demo data · API unreachable' : 'Connecting…';
  }
  function renderTicker(events) {
    const el = $('ticker');
    if (!events || !events.length) return;
    const items = events.map(e => `<span class="tk"><b>${esc(e.type)}</b>${e.round ? ` round #${esc(e.round)}` : ''}${e.at ? ` · ${ago(e.at)}` : ''}${e.tx ? ` · ${esc(String(e.tx).slice(0, 10))}…` : ''}</span>`).join('');
    el.innerHTML = items + items;
  }

  // ------------------------------------------------------------ routing
  let hub = null;
  let current = null;
  const modules = {};

  function openPlanet(id, { fromHub = true } = {}) {
    const i = PLANETS.findIndex(p => p.id === id);
    if (i < 0) return;
    const p = PLANETS[i];
    if (current) closePlanet(false);
    current = p;
    if (hub && fromHub) hub.focusPlanet(i);
    const show = () => {
      if (current !== p) return;
      $('planet').hidden = false;
      $('planet').style.setProperty('--pc', p.css);
      $('planet-name').textContent = p.name;
      $('planet-cat').textContent = `Planet ${i + 1} · ${p.category}`;
      $('planet-glyph').style.background = `radial-gradient(circle at 35% 30%, #fff8, ${p.css} 55%, #0008 100%)`;
      document.body.classList.add('in-planet');
      if (hub) hub.active = false;
      const body = $('planet-body');
      body.innerHTML = '';
      const mod = modules[p.id];
      if (mod) mod.mount(body, ctx);
      else body.innerHTML = '<p class="empty">This planet is still forming.</p>';
      $('back').focus();
    };
    if (location.hash.slice(1) !== p.id) history.replaceState(null, '', '#' + p.id);
    if (fromHub && hub) setTimeout(show, 650); else show();
  }

  function closePlanet(updateHash = true) {
    if (!current) return;
    const mod = modules[current.id];
    if (mod && mod.unmount) mod.unmount();
    current = null;
    $('planet').hidden = true;
    $('planet-body').innerHTML = '';
    document.body.classList.remove('in-planet');
    if (hub) { hub.active = true; hub.last = performance.now(); hub.clearFocus(); }
    if (updateHash && location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  function route() {
    const h = location.hash.slice(1);
    if (h.startsWith('overlay') || h === 'vote') return;
    if (PLANETS.some(p => p.id === h)) { if (!current || current.id !== h) openPlanet(h, { fromHub: false }); }
    else if (current) closePlanet(false);
  }

  const ctx = {
    get profile() { return profile; }, saveProfile, toast, fmtM, fmtClock, esc, ago, bands, bandOf, bandRange, BAND_NAMES, nickname, why,
    planets: PLANETS,
  };

  // ------------------------------------------------------------ boot
  function boot() {
    const D = SR.Data;
    const overlay = location.hash.slice(1).startsWith('overlay') || location.hash === '#vote';

    D.on('mode', setFeed);
    D.on('status', st => {
      updateChips();
      if (hub) hub.setWheel(st.running, st.rpm);
      Object.values(modules).forEach(m => m.onStatus && m.onStatus(st));
    });
    D.on('block', b => Object.values(modules).forEach(m => m.onBlock && m.onBlock(b)));
    D.on('round', r => Object.values(modules).forEach(m => m.onRound && m.onRound(r)));
    // settling is idempotent: each module only acts on rounds it still has a stake on
    D.on('settle', r => Object.values(modules).forEach(m => m.onSettle && m.onSettle(r)));
    D.setPendingProvider(() => [
      ...Object.keys(profile.calls || {}),
      ...Object.keys((profile.oracle && profile.oracle.picks) || {}),
      ...Object.keys((profile.fi && profile.fi.bets) || {}),
      ...Object.keys((profile.stream && profile.stream.polls) || {}),
    ]);
    D.on('economy', e => Object.values(modules).forEach(m => m.onEconomy && m.onEconomy(e)));
    D.on('events', renderTicker);
    D.on('settlements', st => Object.values(modules).forEach(m => m.onSettlements && m.onSettlements(st)));
    setInterval(updateChips, 1000);
    updateChips();

    if (overlay) {
      document.body.classList.add('is-overlay');
      $('hub').hidden = true;
      $('overlay').hidden = false;
      if (location.hash === '#vote') { document.body.classList.add('is-vote'); modules.stream && modules.stream.mountVote($('overlay'), ctx); }
      else modules.stream && modules.stream.mountOverlay($('overlay'), ctx, location.hash.slice(1));
      D.start();
      return;
    }

    // planet list (also the accessible way in on small screens)
    $('planet-list').innerHTML = PLANETS.map((p, i) => `
      <li><button type="button" data-id="${p.id}" style="--pc:${p.css}">
        <span class="dot" aria-hidden="true"></span>
        <span class="pl-body"><b>${p.name}</b><small>${p.category}</small></span>
        <span class="go" aria-hidden="true">→</span>
      </button></li>`).join('');
    $('planet-list').addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b) openPlanet(b.dataset.id); });

    try {
      hub = new SR.Hub($('hub-canvas'), $('labels'), PLANETS, i => openPlanet(PLANETS[i].id));
    } catch (err) {
      document.body.classList.add('no-webgl');
      console.error(err);
    }
    $('back').addEventListener('click', () => closePlanet());
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && current && !(modules[current.id] && modules[current.id].captureEscape && modules[current.id].captureEscape())) closePlanet(); });
    window.addEventListener('hashchange', route);
    D.start();
    route();
  }

  SR.App = { boot, register: (id, mod) => { modules[id] = mod; }, ctx, PLANETS };
})();
