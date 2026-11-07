/* Planet 3 · Oraclea (AI on the wheel)
 * 1. Beat the AI: a forecasting model that runs in your browser (a Markov chain over the bands of the rounds
 *    this device has watched, blended with the wheel's state right now) calls the next round against you.
 * 2. Wheel Painter: a painting that grows a stroke from every live wheel reading and a star for every block. */
'use strict';
(() => {
  const SR = window.SR;
  let el = null, ctx = null;
  const PAINT_KEY = 'squeek-orbit-paint';

  // ---------------------------------------------------------------- the model
  function forecast() {
    const c = ctx || SR.App.ctx;
    const rounds = SR.Data.history().slice(-120);
    const bands = rounds.map(r => c.bandOf(r.distanceM));
    // transition counts with Laplace smoothing
    const T = Array.from({ length: 4 }, () => [1, 1, 1, 1]);
    for (let i = 1; i < bands.length; i++) T[bands[i - 1]][bands[i]]++;
    const last = bands.length ? bands[bands.length - 1] : null;
    let probs = last === null ? [1, 1, 1, 1] : T[last].slice();
    // what the wheel is doing right now nudges the next round
    const st = SR.Data.state.status;
    const now = st.running ? [0.4, 1, 1.4, 1.2 + Math.min(st.rpm / 60, 1)] : [1.6, 1, 0.7, 0.4];
    probs = probs.map((p, i) => p * now[i]);
    const sum = probs.reduce((a, b) => a + b, 0);
    probs = probs.map(p => p / sum);
    const pick = probs.indexOf(Math.max(...probs));
    return { probs, pick, samples: bands.length, last };
  }

  let sig = '';
  function renderDuel() {
    if (!el) return;
    const c = ctx, p = c.profile;
    const next = SR.Data.currentRound() + 1;
    el.querySelector('[data-o="clock"]').textContent = `starts in ${c.fmtClock(SR.Data.secondsLeft())}`;
    const f = forecast();
    const mine = p.oracle.picks[next];
    const nextSig = JSON.stringify([next, mine, p.oracle.you, p.oracle.ai, f.probs.map(x => x.toFixed(2)), SR.Data.state.status.running]);
    if (nextSig === sig) return;
    sig = nextSig;
    el.querySelector('[data-o="you"]').textContent = p.oracle.you;
    el.querySelector('[data-o="ai"]').textContent = p.oracle.ai;
    el.querySelector('[data-o="round"]').textContent = `#${next}`;
    el.querySelector('[data-o="probs"]').innerHTML = c.BAND_NAMES.map((n, i) => `
      <div class="row" style="gap:10px"><span style="width:56px" class="mono small">${n}</span>
      <div class="bar" style="flex:1"><i style="width:${(f.probs[i] * 100).toFixed(0)}%"></i></div>
      <span class="mono small" style="width:40px;text-align:right">${(f.probs[i] * 100).toFixed(0)}%</span></div>`).join('');
    el.querySelector('[data-o="aipick"]').textContent = mine ? c.BAND_NAMES[mine.ai] : c.BAND_NAMES[f.pick];
    el.querySelector('[data-o="why"]').textContent = f.samples
      ? `Learned from ${f.samples} settled rounds${f.last !== null ? `; the last one was a ${c.BAND_NAMES[f.last].toLowerCase()}` : ''}, and the wheel is ${SR.Data.state.status.running ? 'turning' : 'still'} right now.`
      : `No rounds watched yet, so it leans on what the wheel is doing right now (${SR.Data.state.status.running ? 'turning' : 'still'}).`;
    el.querySelector('[data-o="choices"]').innerHTML = c.BAND_NAMES.map((n, i) =>
      `<button type="button" class="choice" data-pick="${i}" aria-pressed="${mine && mine.you === i}" ${mine ? 'disabled' : ''}><b>${n}</b><small>${c.bandRange(i)}</small></button>`).join('');
  }

  // ---------------------------------------------------------------- the painter
  const loadPaint = () => { try { const p = JSON.parse(localStorage.getItem(PAINT_KEY) || 'null'); return p && p.day === dayKey() ? p : { day: dayKey(), strokes: [] }; } catch { return { day: dayKey(), strokes: [] }; } };
  const savePaint = p => { try { localStorage.setItem(PAINT_KEY, JSON.stringify(p)); } catch { /* ignore */ } };
  const dayKey = () => new Date(Date.now() - 12 * 3600 * 1000).toISOString().slice(0, 10);
  let paint = loadPaint();

  function addStroke(st) {
    if (paint.day !== dayKey()) paint = { day: dayKey(), strokes: [] };
    const t = Date.now();
    const s = (t / 1000) | 0;
    paint.strokes.push(st.running
      ? { k: 'run', a: (s % 3600) / 3600 * Math.PI * 2 + (Math.random() - 0.5) * 0.9, r: 0.1 + ((st.todayM || 0) % 700) / 900 + Math.random() * 0.12, len: Math.min(0.6, st.speed * 0.35 + 0.08), hue: (190 + st.rpm * 3 + Math.random() * 40) % 360, w: 1.5 + st.speed * 4 }
      : { k: 'rest', a: (s % 3600) / 3600 * Math.PI * 2, r: 0.08 + Math.random() * 0.8, hue: 250 });
    if (paint.strokes.length > 1800) paint.strokes.splice(0, paint.strokes.length - 1800);
    savePaint(paint);
  }

  function drawPaint() {
    const cv = el && el.querySelector('[data-o="paint"]');
    if (!cv) return;
    const S = 900; cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    const bg = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.7);
    bg.addColorStop(0, '#1d1640'); bg.addColorStop(1, '#07060d');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    for (const k of paint.strokes) {
      const cx = S / 2 + Math.cos(k.a) * k.r * S * 0.45, cy = S / 2 + Math.sin(k.a) * k.r * S * 0.45;
      if (k.k === 'run') {
        g.strokeStyle = `hsla(${k.hue} 90% 62% / .55)`; g.lineWidth = k.w; g.lineCap = 'round';
        g.beginPath(); g.moveTo(cx, cy);
        g.quadraticCurveTo(S / 2 + Math.cos(k.a + 0.3) * k.r * S * 0.5, S / 2 + Math.sin(k.a + 0.3) * k.r * S * 0.5, cx + Math.cos(k.a + 1.6) * k.len * S * 0.25, cy + Math.sin(k.a + 1.6) * k.len * S * 0.25);
        g.stroke();
      } else if (k.k === 'rest') {
        g.fillStyle = 'hsla(250 60% 70% / .25)'; g.beginPath(); g.arc(cx, cy, 1.6, 0, Math.PI * 2); g.fill();
      } else if (k.k === 'block') {
        g.fillStyle = '#f2b33d'; g.save(); g.translate(cx, cy); g.rotate(k.a);
        g.beginPath(); for (let i = 0; i < 10; i++) { const rr = i % 2 ? 6 : 15; g.lineTo(Math.cos(i * Math.PI / 5) * rr, Math.sin(i * Math.PI / 5) * rr); } g.closePath(); g.fill(); g.restore();
      }
    }
    g.fillStyle = '#f3efe6aa'; g.font = '20px "IBM Plex Mono", monospace';
    g.fillText(`Squeektoshi · ${paint.day} · ${paint.strokes.length} marks`, 24, S - 24);
    const meta = el.querySelector('[data-o="paintmeta"]');
    if (meta) {
      const runs = paint.strokes.filter(s => s.k === 'run').length, blocks = paint.strokes.filter(s => s.k === 'block').length;
      meta.textContent = `${runs} running strokes · ${blocks} block stars · ${paint.strokes.length - runs - blocks} resting dots. A new canvas starts every day at 12:00 UTC.`;
    }
  }

  // ---------------------------------------------------------------- planet
  let timer = 0;
  SR.App.register('oracle', {
    mount(root, c) {
      ctx = c; el = root;
      root.innerHTML = `<div class="wrap">
        <div class="cols">
          <section class="card">
            <h3>Beat the AI <span class="tag">Round <span data-o="round"></span> · <span data-o="clock"></span></span></h3>
            <div class="versus">
              <div><div class="muted small">You</div><div class="who" data-o="you">0</div></div>
              <div class="mono muted">vs</div>
              <div><div class="muted small">Oracle AI</div><div class="who" data-o="ai" style="color:var(--pc)">0</div></div>
            </div>
            <p>The Oracle calls <b data-o="aipick" style="color:var(--pc)"></b> for the next round. Can you beat it?</p>
            <div data-o="probs" style="display:grid;gap:6px"></div>
            <p class="note" data-o="why"></p>
            <div class="choices" data-o="choices"></div>
            <p class="small muted">Both calls lock when you pick. The round is scored from the wheel's work counter, so keep a tab open through it. The Oracle is a small statistical model running in your browser: no data leaves your device.</p>
          </section>
          <section class="card">
            <h3>Wheel Painter <span class="tag">generative</span></h3>
            <canvas class="paint" data-o="paint" aria-label="Painting made from today's wheel activity"></canvas>
            <p class="small muted" data-o="paintmeta"></p>
            <div class="row"><button type="button" class="btn" data-act="png">Save PNG</button><button type="button" class="btn" data-act="clear">Start a fresh canvas</button></div>
          </section>
        </div>
      </div>`;
      root.addEventListener('click', e => {
        const pk = e.target.closest('[data-pick]');
        if (pk && !pk.disabled) {
          const next = SR.Data.currentRound() + 1;
          c.profile.oracle.picks[next] = { you: Number(pk.dataset.pick), ai: forecast().pick };
          c.saveProfile();
          c.toast(`Locked for round #${next}: you ${c.BAND_NAMES[pk.dataset.pick]}, Oracle ${c.BAND_NAMES[c.profile.oracle.picks[next].ai]}`);
          renderDuel();
        }
        const a = e.target.closest('[data-act]');
        if (a && a.dataset.act === 'png') {
          const cv = root.querySelector('[data-o="paint"]');
          cv.toBlob(b => { if (!b) return; const u = URL.createObjectURL(b); const l = document.createElement('a'); l.href = u; l.download = `squeektoshi-${paint.day}.png`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); });
        }
        if (a && a.dataset.act === 'clear') { paint = { day: dayKey(), strokes: [] }; savePaint(paint); drawPaint(); }
      });
      sig = ''; renderDuel(); drawPaint();
      timer = setInterval(renderDuel, 1000);
    },
    unmount() { clearInterval(timer); el = null; },
    onStatus(st) { addStroke(st); if (el) drawPaint(); },
    onBlock() { paint.strokes.push({ k: 'block', a: Math.random() * Math.PI * 2, r: 0.2 + Math.random() * 0.7 }); savePaint(paint); if (el) drawPaint(); },
    onSettle(r) {
      const c = ctx || SR.App.ctx, p = c.profile;
      const pick = p.oracle.picks[r.round];
      if (!pick) return;
      delete p.oracle.picks[r.round];
      if (!r.complete) { c.saveProfile(); c.toast(`Oracle duel #${r.round} voided: ${c.why(r)}.`); return; }
      const actual = c.bandOf(r.distanceM);
      if (pick.you === actual) p.oracle.you++;
      if (pick.ai === actual) p.oracle.ai++;
      c.saveProfile();
      c.toast(`Oracle duel #${r.round}: ${c.BAND_NAMES[actual]}. You ${pick.you === actual ? '✓' : '✗'} · AI ${pick.ai === actual ? '✓' : '✗'}`, pick.you === actual ? 'win' : '');
      if (el) renderDuel();
    },
  });
})();
