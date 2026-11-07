/* Planet 1 · Rallyon (Games & mods)
 * Squeek Rally 3D with its own menus: Play, Call Round, Garage, Leaderboard, How to play, Settings. */
'use strict';
(() => {
  const SR = window.SR;
  let root = null, game = null, ctx = null, view = 'main', noticeTimer = 0;

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
      const rounds = SR.Data.state.rounds.slice(-6).reverse();
      m.innerHTML = `<div class="panel">
        <div class="head"><h3>Call round #${next}</h3><span class="pill">${ctx.fmtClock(SR.Data.secondsLeft())} to start</span></div>
        <p class="sub">How far will Squeektoshi run in the next 10-minute round? A correct call doubles your score multiplier for the next run (up to ×4). Calls lock as soon as you pick.</p>
        <div class="choices">${ctx.BAND_NAMES.map((n, i) => `<button type="button" class="choice" data-band="${i}" aria-pressed="${chosen === i}" ${chosen !== undefined ? 'disabled' : ''}><b>${n}</b><small>${ctx.bandRange(i, b.edges)}</small></button>`).join('')}</div>
        <p class="note">${b.learned ? `Bands learned from ${b.learned} rounds this device watched.` : 'Default bands until this device has watched 6 full rounds.'} The round is measured from the wheel's own work counter (one turn ≈ 0.88 m), so keep this page open through the round.${hist ? '' : ''}</p>
        <ul class="list">${rounds.length ? rounds.map(r => `<li><span class="mono muted">#${r.round}</span><span>${ctx.fmtM(r.distanceM)} · ${ctx.BAND_NAMES[ctx.bandOf(r.distanceM)]}</span><span class="pill">${r.work} turns</span></li>`).join('') : '<li class="empty">No complete rounds watched yet.</li>'}</ul>
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
      const runs = [...p.runs].sort((a, b) => b.score - a.score).slice(0, 10);
      m.innerHTML = `<div class="panel">
        <div class="head"><h3>Leaderboard</h3><span class="pill">This device</span></div>
        <ul class="list">${runs.length ? runs.map((r, i) => `<li><span class="mono muted">${i + 1}</span><span><b>${r.score.toLocaleString('en-US')}</b> · ${ctx.fmtM(r.distanceM)} · ${r.seeds} seeds${r.gems ? ` · ${r.gems} crystals` : ''}</span><span class="pill">${new Date(r.at).toLocaleDateString()}</span></li>`).join('') : '<li class="empty">No runs yet. Go play!</li>'}</ul>
        <div class="grid3">
          <div class="stat"><span class="k">Seeds</span><span class="v">${p.totalSeeds}</span></div>
          <div class="stat"><span class="k">SQK coins</span><span class="v">${p.totalCoins}</span></div>
          <div class="stat"><span class="k">Crystals</span><span class="v">${p.totalGems}</span></div>
        </div>
        <button type="button" class="btn" data-act="main">← Back</button>
      </div>`;
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
        <button type="button" class="btn" data-act="reset">Reset Rallyon progress</button>
        <button type="button" class="btn" data-act="main">← Back</button>
      </div>`;
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
    if (skin && !skin.disabled) { ctx.profile.skin = skin.dataset.skin; ctx.saveProfile(); game.setSkin(skin.dataset.skin); show('garage'); return; }
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'play' || act === 'restart') startRun();
    else if (act === 'pause') { game.pause(); show('pause'); }
    else if (act === 'resume') { game.resume(); view = 'play'; setPlaying(true); }
    else if (act === 'quit') { game.toMenu(); show('main'); }
    else if (act === 'orbit') document.getElementById('back').click();
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

  // round results settle calls even when this planet is closed
  function onRound(r) {
    const c = window.SR.App.ctx;
    const p = c.profile;
    if (p.calls[r.round] === undefined) return;
    const call = p.calls[r.round];
    delete p.calls[r.round];
    if (!r.complete) { c.saveProfile(); c.toast(`Round #${r.round}: not fully watched, call refunded.`); return; }
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
    onRound,
    captureEscape() {
      if (view === 'play') { game.pause(); show('pause'); return true; }
      if (view !== 'main' && view !== 'over') { show('main'); return true; }
      return false;
    },
  });
})();
