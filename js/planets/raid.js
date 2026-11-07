/* Planet 2 · Raidus (Server games & bots)
 * Daily Boss Raid: the boss's HP is drained by the hamster's real distance today (the API's daily counter,
 * days run 12:00 to 12:00 UTC), so every visitor sees the same fight. Plus a saga that every round moves
 * forward, and a ready-to-run Discord bot that posts the raid to a community server. */
'use strict';
(() => {
  const SR = window.SR;
  let el = null, ctx = null, timer = 0;

  const BOSSES = ['Pillow Golem', 'Crumb Kraken', 'Sleepy Sphinx', 'Duvet Dragon', 'Snooze Titan', 'Nap Hydra', 'Blanket Wyrm'];
  const PLACES = ['Crumb Canyon', 'Seedfall Ridge', 'the Bedding Wastes', 'Wheelwright Pass', 'the Sunflower Steppe', 'Cage Gate', 'the Shaving Dunes'];
  const FOES = ['pillow-goblins', 'dust bunnies', 'yawn sprites', 'blanket bats', 'lint wolves'];

  const dayKey = () => { const t = new Date(Date.now() - 12 * 3600 * 1000); return t.toISOString().slice(0, 10); };
  const seedOf = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  function boss() {
    const k = dayKey(), s = seedOf(k);
    return { day: k, name: BOSSES[s % BOSSES.length], hp: 3000 + (s % 7) * 500, hue: s % 360, seed: s };
  }

  function drawBoss(cv, b, hpLeft) {
    const g = cv.getContext('2d'), W = cv.width = 280, H = cv.height = 280;
    g.clearRect(0, 0, W, H);
    let s = b.seed;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const px = 14, cols = 12, rows = 12;
    const body = `hsl(${b.hue} 55% ${35 + hpLeft * 20}%)`, dark = `hsl(${b.hue} 50% 18%)`, glow = `hsl(${(b.hue + 40) % 360} 90% 65%)`;
    const cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols / 2; x++) {
      const d = Math.hypot(x - cols / 2 + 0.5, (y - rows / 2) * 0.9);
      if (d < 5.2 && r() > 0.18) cells.push([x, y, d > 4.2 ? dark : body]);
    }
    const ox = (W - cols * px) / 2, oy = (H - rows * px) / 2 + Math.sin(performance.now() / 500) * 4;
    for (const [x, y, c] of cells) { g.fillStyle = c; g.fillRect(ox + x * px, oy + y * px, px, px); g.fillRect(ox + (cols - 1 - x) * px, oy + y * px, px, px); }
    g.fillStyle = glow;
    g.fillRect(ox + 3 * px, oy + 4 * px, px * 1.5, px); g.fillRect(ox + 7.5 * px, oy + 4 * px, px * 1.5, px);
    g.fillStyle = '#0a0912';
    g.fillRect(ox + 4 * px, oy + 7 * px, px * 4, px * (hpLeft > 0.5 ? 0.6 : 1.2));
    if (hpLeft <= 0) { g.fillStyle = '#0a0912b0'; g.fillRect(0, 0, W, H); g.fillStyle = '#67d68f'; g.font = '28px Bungee, sans-serif'; g.textAlign = 'center'; g.fillText('DEFEATED', W / 2, H / 2); }
  }

  function sagaLine(r) {
    const s = (r.round * 2654435761) >>> 0;
    const place = PLACES[s % PLACES.length], foe = FOES[(s >> 3) % FOES.length], n = 1 + (s % 5);
    const d = ctx.fmtM(r.distanceM);
    if (r.distanceM < 5) return `Squeektoshi slept through round #${r.round}. In ${place}, ${n} ${foe} crept closer to the wheel.`;
    if (r.distanceM < 150) return `Round #${r.round}: a careful ${d} jog through ${place}. ${n} ${foe} scattered at the sound of the wheel.`;
    if (r.distanceM < 400) return `Round #${r.round}: Squeektoshi ran ${d} across ${place} and drove off ${n * 2} ${foe}.`;
    return `Round #${r.round}: a legendary ${d} sprint! ${place} trembled and ${n * 4} ${foe} fled the realm.`;
  }
  const sagaKey = 'squeek-orbit-saga';
  const loadSaga = () => { try { return JSON.parse(localStorage.getItem(sagaKey) || '[]'); } catch { return []; } };
  const saveSaga = s => { try { localStorage.setItem(sagaKey, JSON.stringify(s.slice(-80))); } catch { /* ignore */ } };

  const BOT = `// Squeek Orbit raid bot: posts the daily boss fight to a Discord channel.
// Run with Node 18+:  DISCORD_WEBHOOK=https://discord.com/api/webhooks/... node raid-bot.mjs
const API = 'https://api.squeekchain.com/v1/status';
const HOOK = process.env.DISCORD_WEBHOOK;
let last = null;
async function tick() {
  const s = await (await fetch(API)).json();
  const m = s.measurement;
  const today = Number(m.distanceMm) / 1000;
  if (last !== null && today - last >= 50) {
    await fetch(HOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: \`🐹 Squeektoshi hit the boss for \${Math.round(today - last)} m (\${today.toFixed(0)} m today, wheel \${m.coreStatus})\` }) });
    last = today;
  }
  if (last === null || today < last) last = today;
}
setInterval(() => tick().catch(console.error), 60_000);
tick();`;

  function render() {
    if (!el) return;
    const st = SR.Data.state.status;
    const b = boss();
    const today = st.todayM ?? 0;
    const left = Math.max(0, b.hp - today);
    const frac = left / b.hp;
    const p = ctx.profile;
    const cheers = p.raid.picks[b.day] || 0;
    el.querySelector('[data-r="name"]').textContent = b.name;
    el.querySelector('[data-r="hp"]').textContent = `${Math.round(left)} / ${b.hp} HP`;
    el.querySelector('[data-r="bar"]').style.width = `${frac * 100}%`;
    el.querySelector('[data-r="dmg"]').textContent = `${ctx.fmtM(today)} of damage today`;
    el.querySelector('[data-r="status"]').textContent = left <= 0 ? 'Defeated! A new boss arrives at 12:00 UTC.' : st.running ? 'Squeektoshi is attacking right now!' : 'Squeektoshi is resting. The boss regains its nerve…';
    el.querySelector('[data-r="cheers"]').textContent = `${cheers} cheers today · ${p.raid.cheers} all time`;
    drawBoss(el.querySelector('canvas'), b, frac);
  }

  function renderSaga() {
    const list = el && el.querySelector('[data-r="saga"]');
    if (!list) return;
    const saga = loadSaga().slice().reverse();
    list.innerHTML = saga.length ? saga.map(x => `<li>${ctx.esc(x.text)}<small>${new Date(x.at).toLocaleString()}</small></li>`).join('') : '<li>The saga begins with the next full round you watch. Keep this page open.</li>';
  }

  SR.App.register('raid', {
    mount(root, c) {
      ctx = c; el = root;
      const b = boss();
      root.innerHTML = `<div class="wrap">
        <div class="cols">
          <section class="card">
            <h3>Daily Boss Raid <span class="tag">Day ${b.day}</span></h3>
            <div class="boss">
              <canvas width="280" height="280" aria-label="Today's boss"></canvas>
              <b data-r="name" style="font:400 22px var(--display);color:var(--pc)"></b>
              <div class="bar"><i data-r="bar"></i></div>
              <span class="mono" data-r="hp"></span>
              <span class="muted small" data-r="dmg"></span>
              <span class="pill hot" data-r="status"></span>
            </div>
            <p class="small muted">Every metre Squeektoshi runs today (12:00 to 12:00 UTC, from the API's daily counter) is damage. Everyone on Squeekchain fights the same boss.</p>
            <div class="row"><button type="button" class="btn primary" data-act="cheer">📣 Cheer the hamster</button><span class="small muted" data-r="cheers"></span></div>
          </section>
          <section class="card">
            <h3>The Wheel Saga <span class="tag">every round</span></h3>
            <p class="small muted">Each full 10-minute round you watch writes the next line of the story, from that round's real distance.</p>
            <ul class="saga" data-r="saga"></ul>
          </section>
        </div>
        <section class="card">
          <h3>Bring the raid to your server <span class="tag">Discord bot</span></h3>
          <p>A tiny bot for your community: it reads the same public API and posts every 50 m of damage to a Discord channel through a webhook. No keys, no wallet.</p>
          <pre class="raw" data-r="bot"></pre>
          <div class="row"><button type="button" class="btn" data-act="copy">Copy bot code</button><span class="small muted">Save as <span class="mono">raid-bot.mjs</span>, set <span class="mono">DISCORD_WEBHOOK</span>, run with Node 18+.</span></div>
        </section>
      </div>`;
      root.querySelector('[data-r="bot"]').textContent = BOT;
      root.addEventListener('click', e => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'cheer') {
          const st = SR.Data.state.status, day = boss().day;
          if (!st.running) { ctx.toast('Cheers only land while Squeektoshi is running.'); return; }
          const now = Date.now();
          if (now - (ctx.profile.raid.lastCheer || 0) < 20000) { ctx.toast('Catch your breath: one cheer every 20 seconds.'); return; }
          ctx.profile.raid.lastCheer = now;
          ctx.profile.raid.picks[day] = (ctx.profile.raid.picks[day] || 0) + 1;
          ctx.profile.raid.cheers++;
          ctx.saveProfile();
          ctx.toast('📣 Squeektoshi heard you!', 'win');
          render();
        }
        if (a.dataset.act === 'copy') {
          navigator.clipboard.writeText(BOT).then(() => ctx.toast('Bot code copied'), () => ctx.toast('Copy blocked: select the code and copy it manually.'));
        }
      });
      render(); renderSaga();
      timer = setInterval(render, 1000);
    },
    unmount() { clearInterval(timer); el = null; },
    onRound(r) {
      if (!r.complete) return;
      if (!ctx) ctx = SR.App.ctx;
      const saga = loadSaga();
      if (saga.some(x => x.round === r.round)) return;
      saga.push({ round: r.round, text: sagaLine(r), at: Date.now() });
      saveSaga(saga);
      renderSaga();
    },
    onBlock(b) {
      if (!ctx) ctx = SR.App.ctx;
      const saga = loadSaga();
      saga.push({ round: null, text: `Squeek block #${b.height} was forged from the hamster's work. The realm grows stronger.`, at: Date.now() });
      saveSaga(saga);
      renderSaga();
    },
  });
})();
