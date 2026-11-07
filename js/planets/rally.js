/* Planet 1 · Rallyon (Games & mods)
 * Squeek Rally 3D with its own menus: Play, Call Round, Garage, Leaderboard, How to play, Settings. */
'use strict';
(() => {
  const SR = window.SR;
  let root = null, game = null, ctx = null, view = 'main', noticeTimer = 0, boardTab = 'all';

  const UNLOCKS = {
    classic:  { need: () => true, text: 'Always unlocked' },
    sapphire: { need: p => p.totalSeeds >= 300, text: 'Collect 300 seeds in total' },
    night:    { need: p => p.best >= 15000, text: 'Score 15,000 in one run' },
    genesis:  { need: p => p.correctCalls >= 3, text: 'Call 3 rounds correctly' },
  };

  function build() {
    root = document.createElement('div');
    root.className = 'rally';
    root.innerHTML = `
      <canvas aria-label="Squeek Rally 3D game"></canvas>
      <div class="r-hud" hidden>
        <div class="r-box"><span class="k">Score</span><span class="v" data-h="score">0</span><span class="s" data-h="mult">×1</span></div>
        <div class="r-box r-power" data-h="powerbox"><span class="k" data-h="powerlabel">Wheel power</span><span class="v" data-h="power">×1.0</span><div class="bar"><i data-h="powerbar" style="width:0%"></i></div></div>
        <div class="r-right">
          <div class="r-box"><span class="k">Lives</span><div class="lives" data-h="lives"></div></div>
          <button type="button" class="r-pause" data-act="pause" aria-label="Pause">❚❚</button>
        </div>
      </div>
      <div class="r-bottom" hidden><span class="r-pick" data-h="loot">0 seeds · 0 coins · 0 crystals</span><span class="r-pick" data-h="callchip"></span></div>
      <div class="r-touch" hidden aria-hidden="true">
        <button type="button" data-press="left">◀</button>
        <button type="button" class="jump" data-press="jump">JUMP</button>
        <button type="button" data-press="right">▶</button>
      </div>
      <div class="r-notice" data-h="notice"></div>
      <div class="r-menu" data-h="menu"></div>`;
    game = new SR.Game(root.querySelector('canvas'));
    game.on('hud', hud);
    game.on('notice', n => notice(n.text));
    game.on('over', over);
    root.addEventListener('click', onClick);
    root.querySelectorAll('[data-press]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); game.press(b.dataset.press); }));
  }

  const $h = k => root.querySelector(`[data-h="${k}"]`);

  function notice(text) {
    const n = $h('notice');
    n.textContent = text;
    n.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => n.classList.remove('show'), 2600);
  }

  function hud(h) {
    $h('score').textContent = h.score.toLocaleString('en-US');
    $h('mult').textContent = `×${h.multiplier} call boost · ${ctx.fmtM(h.distanceM)}`;
    $h('power').textContent = `×${h.power.toFixed(1)}`;
    $h('powerlabel').textContent = h.running ? 'Wheel power · Squeektoshi running' : 'Wheel power · Squeektoshi resting';
    $h('powerbox').classList.toggle('night', !h.running);
    $h('powerbar').style.width = `${Math.min(100, ((h.power - 1) / 1.5) * 100)}%`;
    $h('lives').innerHTML = Array.from({ length: 3 }, (_, i) => `<i class="${i < h.lives ? '' : 'lost'}"></i>`).join('');
    $h('loot').textContent = `${h.seeds} seeds · ${h.coins} SQK coins · ${h.gems} block crystals`;
  }

  function setPlaying(on) {
    root.querySelector('.r-hud').hidden = !on;
    root.querySelector('.r-bottom').hidden = !on;
    root.querySelector('.r-touch').hidden = !on;
    $h('menu').hidden = on;
  }

  function callChip() {
    const p = ctx.profile, next = SR.Data.currentRound() + 1;
    const c = p.calls[next];
    return c === undefined ? `Round #${next}: no call yet` : `Round #${next}: you called <b>${ctx.BAND_NAMES[c]}</b>`;
  }

  // ---------------------------------------------------------------- menus
  function show(v) {
    view = v;
    const m = $h('menu');
    const p = ctx.profile;
    setPlaying(false);
    if (v === 'main') {
      m.innerHTML = `<div class="panel">
        <div class="head"><h3>Squeek Rally</h3><span class="pill hot">Planet 1</span></div>
        <p class="sub">Roll a hamster ball down a floating road. While Squeektoshi runs on the real wheel, the road turns gold and Wheel Power boosts your speed and score. Every Squeek block mined on Squeekchain drops a crystal on the road.</p>
        <button type="button" class="btn primary play" data-act="play">▶ Play${p.boost > 1 ? ` · ×${p.boost} call boost` : ''}</button>
        <div class="menu-grid">
          <button type="button" class="btn" data-act="call">🎯 Call round</button>
          <button type="button" class="btn" data-act="garage">🐹 Garage</button>
          <button type="button" class="btn" data-act="board">🏆 Leaderboard</button>
          <button type="button" class="btn" data-act="how">❔ How to play</button>
          <button type="button" class="btn" data-act="settings">⚙ Settings</button>
          <button type="button" class="btn" data-act="orbit">🪐 Back to orbit</button>
        </div>
        <p class="small muted">Best ${p.best.toLocaleString('en-US')} · ${p.totalSeeds} seeds · ${p.correctCalls}/${p.totalCalls} calls right</p>
      </div>`;
    } else if (v === 'call') {
      const next = SR.Data.currentRound() + 1;
      const b = ctx.bands();
      const chosen = p.calls[next];
      const hist = Object.entries(p.calls).filter(([r]) => Number(r) > next).length;
      const rounds = SR.Data.history().slice(-6).reverse();
      const pend = Object.keys(p.calls).map(Number).filter(r => r < next).sort((a, b) => b - a);
      m.innerHTML = `<div class="panel">
        <div class="head"><h3>Call round #${next}</h3><span class="pill">${ctx.fmtClock(SR.Data.secondsLeft())} to start</span></div>
        <p class="sub">How far will Squeektoshi run in the next 10-minute round? A correct call doubles your score multiplier for the next run (up to ×4). Calls lock as soon as you pick.</p>
        <div class="choices">${ctx.BAND_NAMES.map((n, i) => `<button type="button" class="choice" data-band="${i}" aria-pressed="${chosen === i}" ${chosen !== undefined ? 'disabled' : ''}><b>${n}</b><small>${ctx.bandRange(i, b.edges)}</small></button>`).join('')}</div>
        <p class="note">${b.learned ? `Bands learned from ${b.learned} settled rounds.` : 'Default bands until 6 rounds have settled.'} Calls are settled from the round's on-chain settlement on Sepolia (work added × 0.88 m), so you can close the tab: the result is waiting when you come back.${hist ? '' : ''}</p>
        ${pend.length ? `<p class="small">Waiting for settlement: ${pend.map(r => `<span class="pill">#${r} · ${ctx.BAND_NAMES[p.calls[r]]}</span>`).join(' ')}</p>` : ''}
        <ul class="list">${rounds.length ? rounds.map(r => `<li><span class="mono muted">#${r.round}</span><span>${ctx.fmtM(r.distanceM)} · ${ctx.BAND_NAMES[ctx.bandOf(r.distanceM)]}</span><span class="pill ${r.source === 'chain' ? 'ok' : ''}" title="${r.tx ? ctx.esc(r.tx) : ''}">${r.source === 'chain' ? 'on-chain' : 'measured'} · ${r.work} turns</span></li>`).join('') : '<li class="empty">No settled rounds yet.</li>'}</ul>
        <button type="button" class="btn" data-act="main">← Back</button>
      </div>`;
    } else if (v === 'garage') {
      m.innerHTML = `<div class="panel">
        <div class="head"><h3>Garage</h3><span class="pill">${SR.SKINS[p.skin].name}</span></div>
        <div class="skins">${Object.entries(SR.SKINS).map(([id, s]) => {
          const ok = UNLOCKS[id].need(p);
          const col = `rgb(${s.ring.map(c => Math.round(c * 255)).join(',')})`;
          return `<button type="button" class="skin" data-skin="${id}" aria-pressed="${p.skin === id}" ${ok ? '' : 'disabled'} style="--sk:${col}"><span class="ball"></span><span><b>${s.name}</b><small>${ok ? (p.skin === id ? 'Selected' : 'Unlocked') : '🔒 ' + UNLOCKS[id].text}</small></span></button>`;
        }).join('')}</div>
        <button type="button" class="btn" data-act="main">← Back</button>
      </div>`;
    } else if (v === 'board') {
      const net = SR.Net && SR.Net.enabled();
      const tab = net ? boardTab : 'device';
      const runs = [...p.runs].sort((a, b) => b.score - a.score).slice(0, 10);
      m.innerHTML = `<div class="panel">
        <div class="head"><h3>Leaderboard</h3><span class="pill">${tab === 'device' ? 'This device' : tab === 'week' ? 'Everyone · 7 days' : 'Everyone · all time'}</span></div>
        <div class="board-tabs">${[['device', 'This device'], ['all', 'Global'], ['week', 'This week']].map(([k, n]) => `<button type="button" class="btn ${tab === k ? 'primary' : ''}" data-board="${k}" ${k !== 'device' && !net ? 'disabled' : ''}>${n}</button>`).join('')}</div>
        ${tab === 'device' ? `<ul class="list">${runs.length ? runs.map((r, i) => `<li><span class="mono muted">${i + 1}</span><span><b>${r.score.toLocaleString('en-US')}</b> · ${ctx.fmtM(r.distanceM)} · ${r.seeds} seeds${r.gems ? ` · ${r.gems} crystals` : ''}</span><span class="pill">${new Date(r.at).toLocaleDateString()}</span></li>`).join('') : '<li class="empty">No runs yet. Go play!</li>'}</ul>`
          : '<ul class="list" data-global><li class="empty">Loading the global board…</li></ul>'}
        ${net ? `<p class="small muted">You appear as <b>${ctx.esc(ctx.nickname())}</b>. Change it in Settings.</p>` : '<p class="small muted">Global boards need the shared server. Add one in Settings.</p>'}
        <div class="grid3">
          <div class="stat"><span class="k">Seeds</span><span class="v">${p.totalSeeds}</span></div>
          <div class="stat"><span class="k">SQK coins</span><span class="v">${p.totalCoins}</span></div>
          <div class="stat"><span class="k">Crystals</span><span class="v">${p.totalGems}</span></div>
        </div>
        <button type="button" class="btn" data-act="main">← Back</button>
      </div>`;
      if (tab !== 'device') {
        SR.Net.leaderboard(tab).then(j => {
          const ul = m.querySelector('[data-global]');
          if (!ul) return;
          const nick = ctx.nickname();
          ul.innerHTML = j.top.length ? j.top.map(r => `<li style="${r.name === nick ? 'outline:1px solid var(--pc)' : ''}"><span class="mono muted">${r.rank}</span><span><b>${ctx.esc(r.name)}</b> · ${r.score.toLocaleString('en-US')} · ${ctx.fmtM(r.distanceM)}</span><span class="pill">${ctx.esc(SR.SKINS[r.skin] ? SR.SKINS[r.skin].name : r.skin)}</span></li>`).join('') + `<li class="empty">${j.players} players · ${j.runs} runs</li>` : '<li class="empty">No runs on the server yet. Be the first!</li>';
        }).catch(e => { const ul = m.querySelector('[data-global]'); if (ul) ul.innerHTML = `<li class="empty">Could not reach the server: ${ctx.esc(e.message)}</li>`; });
      }
    } else if (v === 'how') {
      m.innerHTML = `<div class="panel">
        <div class="head"><h3>How to play</h3></div>
        <ul class="how">
          <li>Switch lanes with <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd>. Jump with <kbd>↑</kbd> <kbd>W</kbd> or <kbd>Space</kbd>, drop fast with <kbd>↓</kbd>. On phones, swipe or use the buttons.</li>
          <li>Avoid <b>holes</b> in the road, <b>pillows</b> (more of them while Squeektoshi sleeps) and jump the red <b>hurdles</b>. You have 3 lives.</li>
          <li><b>Seeds</b> are worth 25 × Wheel Power. <b>SQK coins</b> only appear while the real wheel turns (+200).</li>
          <li>Each real <b>Squeek block</b> mined while you play drops a <b>block crystal</b> (+1,500).</li>
          <li><b>Call the next round</b> from the menu. A correct call doubles your multiplier for the next run.</li>
        </ul>
        <button type="button" class="btn" data-act="main">← Back</button>
      </div>`;
    } else if (v === 'settings') {
      const s = p.settings;
      m.innerHTML = `<div class="panel">
        <div class="head"><h3>Settings</h3></div>
        <label class="toggle"><span>Sound effects</span><input type="checkbox" data-set="sound" ${s.sound ? 'checked' : ''}></label>
        <label class="toggle"><span>Camera shake</span><input type="checkbox" data-set="shake" ${s.shake ? 'checked' : ''}></label>
        <label class="toggle"><span>Graphics quality</span>
          <select class="input" style="width:auto" data-set="quality">${['high', 'medium', 'low'].map(q => `<option value="${q}" ${s.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
        <label class="toggle"><span>Nickname on shared boards</span>
          <input class="input" style="width:170px" data-nick maxlength="20" value="${ctx.esc(ctx.nickname())}" aria-label="Nickname"></label>
        <div class="toggle" style="display:grid;gap:6px;justify-items:stretch">
          <span><span class="srv-dot ${SR.Net.status}"></span>Shared server <small class="muted">(${SR.Net.status === 'ok' ? 'connected' : SR.Net.status === 'down' ? 'unreachable' : SR.Net.status === 'off' ? 'not set: everything stays on this device' : 'checking…'})</small></span>
          <div class="row"><input class="input" style="flex:1" data-srv placeholder="https://squeek-orbit.you.workers.dev" value="${ctx.esc(SR.Net.base)}" spellcheck="false"><button type="button" class="btn" data-act="srv-save">Save</button></div>
          <small class="muted">Deploy your own from the <span class="mono">server/</span> folder (Cloudflare Workers + D1, free tier). It shares the leaderboard, raid cheers, audience polls and the round history.</small>
        </div>
        <button type="button" class="btn" data-act="reset">Reset Rallyon progress</button>
        <button type="button" class="btn" data-act="main">← Back</button>
      </div>`;
      m.querySelector('[data-nick]').addEventListener('change', e => {
        const n = e.target.value.trim().replace(/\s+/g, ' ');
        if (!/^[A-Za-z0-9 _.\-]{3,20}$/.test(n)) { ctx.toast('Nicknames are 3–20 letters, numbers, spaces, _ . or -'); e.target.value = ctx.nickname(); return; }
        ctx.profile.nickname = n; ctx.saveProfile(); ctx.toast(`You are now ${n}`);
      });
      m.querySelectorAll('[data-set]').forEach(el => el.addEventListener('change', () => {
        const k = el.dataset.set;
        s[k] = el.type === 'checkbox' ? el.checked : el.value;
        ctx.saveProfile();
        applySettings();
      }));
    } else if (v === 'pause') {
      m.innerHTML = `<div class="panel">
        <div class="head"><h3>Paused</h3></div>
        <button type="button" class="btn primary play" data-act="resume">▶ Resume</button>
        <div class="menu-grid">
          <button type="button" class="btn" data-act="restart">↻ Restart</button>
          <button type="button" class="btn" data-act="quit">☰ Main menu</button>
        </div>
      </div>`;
    }
  }

  function over(r) {
    const p = ctx.profile;
    const newBest = r.score > p.best;
    p.best = Math.max(p.best, r.score);
    p.totalSeeds += r.seeds; p.totalCoins += r.coins; p.totalGems += r.gems;
    p.runs.push({ ...r, at: Date.now() });
    p.runs = p.runs.sort((a, b) => b.score - a.score).slice(0, 25);
    ctx.saveProfile();
    if (SR.Net && SR.Net.enabled() && r.score > 0) {
      SR.Net.submitRun({ score: r.score, distanceM: r.distanceM, seeds: r.seeds, coins: r.coins, gems: r.gems, durationS: r.durationS, multiplier: r.multiplier, skin: p.skin }, ctx.nickname())
        .then(j => { const chip = root.querySelector('[data-rank]'); if (chip) chip.textContent = `Global rank #${j.rank}`; })
        .catch(e => { const chip = root.querySelector('[data-rank]'); if (chip) chip.textContent = `Not on the global board: ${e.message}`; });
    }
    setPlaying(false);
    view = 'over';
    $h('menu').innerHTML = `<div class="panel">
      <div class="head"><h3>Run over</h3>${newBest ? '<span class="pill ok">New best!</span>' : ''}</div>
      <div class="big-score">${r.score.toLocaleString('en-US')}</div>
      <div class="grid3">
        <div class="stat"><span class="k">Distance</span><span class="v">${ctx.fmtM(r.distanceM)}</span></div>
        <div class="stat"><span class="k">Seeds</span><span class="v">${r.seeds}</span></div>
        <div class="stat"><span class="k">Crystals</span><span class="v">${r.gems}</span></div>
      </div>
      ${SR.Net && SR.Net.enabled() ? '<p class="small" data-rank>Sending to the global board…</p>' : ''}
      <p class="small muted">Best ${p.best.toLocaleString('en-US')}${r.multiplier > 1 ? ` · this run used a ×${r.multiplier} call boost` : ''}. ${callChip()}.</p>
      <div class="menu-grid">
        <button type="button" class="btn primary" data-act="play">↻ Play again</button>
        <button type="button" class="btn" data-act="call">🎯 Call next round</button>
        <button type="button" class="btn" data-act="main">☰ Main menu</button>
        <button type="button" class="btn" data-act="orbit">🪐 Back to orbit</button>
      </div>
    </div>`;
  }

  function startRun() {
    const p = ctx.profile;
    game.setSkin(p.skin);
    game.startRun({ multiplier: p.boost || 1 });
    p.boost = 1;          // a call boost is used up by the run that starts with it
    ctx.saveProfile();
    view = 'play';
    setPlaying(true);
    $h('callchip').innerHTML = callChip();
    root.querySelector('canvas').focus?.();
  }

  function onClick(e) {
    const a = e.target.closest('[data-act]');
    const band = e.target.closest('[data-band]');
    const skin = e.target.closest('[data-skin]');
    if (band && !band.disabled) {
      const next = SR.Data.currentRound() + 1;
      ctx.profile.calls[next] = Number(band.dataset.band);
      ctx.saveProfile();
      ctx.toast(`Locked: round #${next} will be a ${ctx.BAND_NAMES[band.dataset.band].toLowerCase()}`);
      show('call');
      return;
    }
    const bt = e.target.closest('[data-board]');
    if (bt && !bt.disabled) { boardTab = bt.dataset.board; show('board'); return; }
    if (skin && !skin.disabled) { ctx.profile.skin = skin.dataset.skin; ctx.saveProfile(); game.setSkin(skin.dataset.skin); show('garage'); return; }
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'play' || act === 'restart') startRun();
    else if (act === 'pause') { game.pause(); show('pause'); }
    else if (act === 'resume') { game.resume(); view = 'play'; setPlaying(true); }
    else if (act === 'quit') { game.toMenu(); show('main'); }
    else if (act === 'orbit') document.getElementById('back').click();
    else if (act === 'srv-save') {
      const v = root.querySelector('[data-srv]').value;
      if (!SR.Net.setBase(v)) { ctx.toast('Use an https:// address (or http://localhost for testing).'); return; }
      ctx.toast(v ? 'Server saved. Checking…' : 'Shared server removed');
      setTimeout(() => { if (view === 'settings') show('settings'); }, 1500);
    }
    else if (act === 'reset') {
      Object.assign(ctx.profile, { runs: [], best: 0, totalSeeds: 0, totalCoins: 0, totalGems: 0, boost: 1, skin: 'classic' });
      ctx.saveProfile(); game.setSkin('classic'); ctx.toast('Rallyon progress reset'); show('settings');
    } else show(act);
  }

  function applySettings() {
    const s = ctx.profile.settings;
    game.setSound(s.sound);
    game.setQuality(s.quality);
    game.noShake = !s.shake;
  }

  // settled rounds close calls even when this planet (or the whole tab) was closed during the round
  function onSettle(r) {
    const c = window.SR.App.ctx;
    const p = c.profile;
    if (p.calls[r.round] === undefined) return;
    const call = p.calls[r.round];
    delete p.calls[r.round];
    if (!r.complete) { c.saveProfile(); c.toast(`Round #${r.round}: ${c.why(r)}, call refunded.`); return; }
    p.totalCalls++;
    const win = c.bandOf(r.distanceM) === call;
    if (win) { p.correctCalls++; p.boost = Math.min(4, (p.boost || 1) * 2); }
    c.saveProfile();
    c.toast(win ? `Round #${r.round}: ${c.fmtM(r.distanceM)}. You called it! Next run ×${p.boost}.` : `Round #${r.round}: ${c.fmtM(r.distanceM)} (${c.BAND_NAMES[c.bandOf(r.distanceM)]}). Missed.`, win ? 'win' : 'lose');
    if (view === 'call' && root && root.isConnected) show('call');
  }

  SR.App.register('rally', {
    mount(el, c) {
      ctx = c;
      if (!root) build();
      el.appendChild(root);
      applySettings();
      game.active = true;
      game.last = performance.now();
      const st = SR.Data.state.status;
      game.setWheel(st.running, st.rpm);
      if (view === 'play') { game.pause(); show('pause'); } else if (view !== 'over') show('main');
    },
    unmount() { if (game) { if (game.mode === 'play') game.pause(); if (view === 'play') view = 'pause'; game.active = false; } },
    onStatus(st) { if (game) game.setWheel(st.running, st.rpm); },
    onBlock(b) { if (game) game.blockMined(b.height); },
    onSettle,
    captureEscape() {
      if (view === 'play') { game.pause(); show('pause'); return true; }
      if (view !== 'main' && view !== 'over') { show('main'); return true; }
      return false;
    },
  });
})();
