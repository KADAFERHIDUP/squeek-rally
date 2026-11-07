/* Planet 8 · Evolvia (Dynamic NFTs that evolve with the hamster)
 * A living Squeek whose art and traits are a pure function of public wheel data:
 *   stage     ← today's distance (API daily counter, 12:00–12:00 UTC)
 *   fur hue   ← lifetime wheel turns (cumulativeWorkUnits)
 *   aura      ← Squeek blocks mined today (block height now minus the first height seen today)
 *   mood      ← wheel running or resting right now
 *   relics    ← rounds and blocks this device has witnessed
 * It exports ERC-721 style metadata, the shape a tokenURI for a dynamic NFT would return. */
'use strict';
(() => {
  const SR = window.SR;
  let el = null, ctx = null, raf = 0;
  const KEY = 'squeek-orbit-evolve';
  const STAGES = [
    { name: 'Egg', at: 0 }, { name: 'Pup', at: 100 }, { name: 'Scout', at: 500 },
    { name: 'Runner', at: 1500 }, { name: 'Sprinter', at: 3000 }, { name: 'Legend', at: 5000 },
  ];
  const dayKey = () => new Date(Date.now() - 12 * 3600 * 1000).toISOString().slice(0, 10);
  let mem = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ignore */ } };

  function traits() {
    const st = SR.Data.state.status;
    const today = st.todayM ?? 0;
    let stage = 0;
    STAGES.forEach((s, i) => { if (today >= s.at) stage = i; });
    const hue = st.cumWork === null ? 30 : Math.round((st.cumWork / 40) % 360);
    const blocksToday = mem.day === dayKey() && mem.dayStartHeight != null && st.blockHeight != null ? Math.max(0, st.blockHeight - mem.dayStartHeight) : 0;
    const rounds = SR.Data.history().length;
    const sprints = SR.Data.history().filter(r => r.distanceM >= 400).length;
    return {
      stage, stageName: STAGES[stage].name, today, hue, blocksToday, running: st.running, rpm: st.rpm,
      crown: rounds >= 10, scarf: sprints >= 1, star: (mem.blocksSeen || 0) >= 1,
      next: STAGES[stage + 1] || null,
    };
  }

  function draw(cv, t, time) {
    const g = cv.getContext('2d');
    const S = 720; if (cv.width !== S) { cv.width = S; cv.height = S; }
    g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S * 0.56;
    const fur = `hsl(${t.hue} 62% 62%)`, furDark = `hsl(${t.hue} 45% 42%)`, belly = `hsl(${t.hue} 70% 88%)`;

    // aura rings: one per block mined today (max 12)
    for (let i = 0; i < Math.min(12, t.blocksToday); i++) {
      g.strokeStyle = `hsla(${(t.hue + 40 + i * 12) % 360} 90% 65% / ${0.5 - i * 0.03})`;
      g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy - 20, 170 + i * 14 + Math.sin(time * 2 + i) * 3, 0, Math.PI * 2); g.stroke();
    }
    // ground shadow
    g.fillStyle = '#0006'; g.beginPath(); g.ellipse(cx, S * 0.86, 150, 22, 0, 0, Math.PI * 2); g.fill();

    if (t.stage === 0) {
      // the egg wobbles while the wheel turns
      const wob = t.running ? Math.sin(time * 10) * 0.08 : 0;
      g.save(); g.translate(cx, cy + 40); g.rotate(wob);
      const eg = g.createLinearGradient(0, -170, 0, 120); eg.addColorStop(0, belly); eg.addColorStop(1, fur);
      g.fillStyle = eg; g.beginPath(); g.ellipse(0, 0, 105, 140, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = furDark; g.lineWidth = 4; g.beginPath();
      const crack = Math.min(1, t.today / 100);
      g.moveTo(-60, -20); for (let i = 0; i < 6 * crack; i++) g.lineTo(-60 + i * 22, -20 + (i % 2 ? -18 : 12)); g.stroke();
      g.restore();
      return;
    }
    const size = [0, 0.62, 0.74, 0.86, 0.96, 1.06][t.stage];
    const bounce = t.running ? Math.abs(Math.sin(time * (6 + t.rpm / 20))) * 22 : Math.sin(time * 1.5) * 3;
    g.save(); g.translate(cx, cy - bounce); g.scale(size, size);
    // tail, feet
    g.fillStyle = furDark; g.beginPath(); g.arc(150, 70, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f3c4b8'; for (const fx of [-70, 70]) { g.beginPath(); g.ellipse(fx, 150, 34, 18, 0, 0, Math.PI * 2); g.fill(); }
    // body
    const bg = g.createRadialGradient(-40, -60, 20, 0, 0, 220); bg.addColorStop(0, belly); bg.addColorStop(0.35, fur); bg.addColorStop(1, furDark);
    g.fillStyle = bg; g.beginPath(); g.ellipse(0, 20, 170, 150, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = belly; g.beginPath(); g.ellipse(0, 70, 95, 85, 0, 0, Math.PI * 2); g.fill();
    // ears
    for (const ex of [-100, 100]) {
      g.fillStyle = fur; g.beginPath(); g.arc(ex, -105, 44, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f3a4b4'; g.beginPath(); g.arc(ex, -105, 26, 0, Math.PI * 2); g.fill();
    }
    // face
    if (t.running) {
      g.fillStyle = '#16121e'; for (const ex of [-55, 55]) { g.beginPath(); g.arc(ex, -30, 17, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#fff'; for (const ex of [-60, 50]) { g.beginPath(); g.arc(ex, -36, 6, 0, Math.PI * 2); g.fill(); }
    } else {
      g.strokeStyle = '#16121e'; g.lineWidth = 6; g.lineCap = 'round';
      for (const ex of [-55, 55]) { g.beginPath(); g.arc(ex, -32, 14, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
    }
    g.fillStyle = '#ff8fa3'; g.beginPath(); g.ellipse(0, 0, 13, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff9fb366'; for (const ex of [-95, 95]) { g.beginPath(); g.ellipse(ex, 10, 28, 18, 0, 0, Math.PI * 2); g.fill(); }
    // relics
    if (t.scarf) { g.fillStyle = '#e8574f'; g.beginPath(); g.ellipse(0, 52, 120, 22, 0, 0, Math.PI * 2); g.fill(); g.fillRect(40, 52, 30, 70); }
    if (t.crown) {
      g.fillStyle = '#f2b33d'; g.beginPath(); g.moveTo(-60, -150); g.lineTo(-60, -195); g.lineTo(-30, -170); g.lineTo(0, -205); g.lineTo(30, -170); g.lineTo(60, -195); g.lineTo(60, -150); g.closePath(); g.fill();
    }
    if (t.star) {
      g.save(); g.translate(115, 60); g.fillStyle = '#f2b33d'; g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 9 : 22; g.lineTo(Math.cos(i * Math.PI / 5 - Math.PI / 2) * r, Math.sin(i * Math.PI / 5 - Math.PI / 2) * r); }
      g.closePath(); g.fill(); g.restore();
    }
    g.restore();
    // sleeping Zzz or motion lines
    g.fillStyle = '#f3efe6aa';
    if (!t.running) { g.font = '40px Bungee, sans-serif'; g.fillText('z', cx + 140, cy - 170 + Math.sin(time) * 6); g.font = '28px Bungee, sans-serif'; g.fillText('z', cx + 175, cy - 205 + Math.sin(time + 1) * 6); }
    else { g.strokeStyle = '#f3efe655'; g.lineWidth = 5; for (let i = 0; i < 3; i++) { const y = cy - 40 + i * 50; g.beginPath(); g.moveTo(cx - 260 - ((time * 300 + i * 80) % 120), y); g.lineTo(cx - 200 - ((time * 300 + i * 80) % 120), y); g.stroke(); } }
  }

  function metadata(t) {
    const st = SR.Data.state.status;
    return {
      name: `Squeektoshi's Echo · ${t.stageName}`,
      description: 'A dynamic Squeek that evolves with the real hamster on Squeekchain: stage from today\'s distance, fur from lifetime wheel turns, aura from blocks mined today.',
      external_url: location.origin + location.pathname + '#evolve',
      attributes: [
        { trait_type: 'Stage', value: t.stageName },
        { trait_type: 'Distance today (m)', value: Math.round(t.today), display_type: 'number' },
        { trait_type: 'Fur hue', value: t.hue, display_type: 'number' },
        { trait_type: 'Aura rings', value: t.blocksToday, display_type: 'number' },
        { trait_type: 'Mood', value: t.running ? 'Running' : 'Sleeping' },
        { trait_type: 'Crown', value: t.crown ? 'Yes' : 'No' },
        { trait_type: 'Scarf', value: t.scarf ? 'Yes' : 'No' },
        { trait_type: 'Block star', value: t.star ? 'Yes' : 'No' },
        { trait_type: 'Wheel turns (lifetime)', value: st.cumWork ?? 0, display_type: 'number' },
      ],
    };
  }

  function renderInfo() {
    if (!el) return;
    const t = traits();
    if (mem.lastStage !== t.stageName) {
      mem.timeline = [...(mem.timeline || []), { stage: t.stageName, at: Date.now() }].slice(-20);
      mem.lastStage = t.stageName; save();
    }
    el.querySelector('[data-e="traits"]').innerHTML = `
      <div class="stat"><span class="k">Stage</span><span class="v">${t.stageName}</span><span class="s">${t.next ? `${ctx.fmtM(t.next.at - t.today)} to ${t.next.name}` : 'fully evolved'}</span></div>
      <div class="stat"><span class="k">Today</span><span class="v">${ctx.fmtM(t.today)}</span><span class="s">sets the stage</span></div>
      <div class="stat"><span class="k">Aura rings</span><span class="v">${t.blocksToday}</span><span class="s">blocks mined today</span></div>
      <div class="stat"><span class="k">Fur hue</span><span class="v" style="color:hsl(${t.hue} 62% 62%)">${t.hue}°</span><span class="s">from lifetime turns</span></div>`;
    const bar = t.next ? (t.today - STAGES[t.stage].at) / (t.next.at - STAGES[t.stage].at) : 1;
    el.querySelector('[data-e="bar"]').style.width = `${Math.min(100, bar * 100)}%`;
    el.querySelector('[data-e="relics"]').innerHTML = [
      ['👑 Crown', t.crown, '10 settled rounds'], ['🧣 Scarf', t.scarf, 'a sprint round (≥ 400 m) on record'], ['⭐ Block star', t.star, 'witness a Squeek block being mined'],
    ].map(([n, ok, how]) => `<li><span>${n}</span><span class="small muted">${how}</span><span class="pill ${ok ? 'ok' : ''}">${ok ? 'earned' : 'locked'}</span></li>`).join('');
    el.querySelector('[data-e="timeline"]').innerHTML = (mem.timeline || []).slice().reverse().map(x => `<li><span class="pill hot">${x.stage}</span><span class="small">${new Date(x.at).toLocaleString()}</span><span></span></li>`).join('') || '<li class="empty">Evolution starts now.</li>';
    el.querySelector('[data-e="meta"]').textContent = JSON.stringify(metadata(t), null, 2);
  }

  function loop() {
    if (!el) return;
    const cv = el.querySelector('[data-e="art"]');
    if (cv) draw(cv, traits(), performance.now() / 1000);
    raf = requestAnimationFrame(loop);
  }

  let infoTimer = 0;
  SR.App.register('evolve', {
    mount(root, c) {
      ctx = c; el = root;
      root.innerHTML = `<div class="wrap">
        <div class="cols">
          <section class="card">
            <h3>Squeektoshi's Echo <span class="tag">dynamic NFT</span></h3>
            <canvas class="creature" data-e="art" aria-label="The evolving Squeek"></canvas>
            <div class="bar"><i data-e="bar"></i></div>
            <div class="row"><button type="button" class="btn" data-act="png">Save PNG</button><button type="button" class="btn" data-act="meta">Copy metadata JSON</button></div>
          </section>
          <section class="card">
            <h3>Traits <span class="tag">live from the wheel</span></h3>
            <div class="grid4" data-e="traits" style="grid-template-columns:repeat(2,1fr)"></div>
            <h3 style="margin-top:6px">Relics</h3>
            <ul class="list" data-e="relics"></ul>
            <h3 style="margin-top:6px">Evolution log</h3>
            <ul class="list" data-e="timeline" style="max-height:160px"></ul>
          </section>
        </div>
        <details class="card"><summary>Token metadata (what a dynamic tokenURI would return)</summary><pre class="raw" data-e="meta"></pre>
          <p class="small muted">This is a prototype, not a minted token: the art and traits are computed in your browser from public Squeekchain data, exactly as an on-chain renderer or metadata server could.</p></details>
      </div>`;
      root.addEventListener('click', e => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'png') root.querySelector('[data-e="art"]').toBlob(b => { if (!b) return; const u = URL.createObjectURL(b); const l = document.createElement('a'); l.href = u; l.download = 'squeektoshis-echo.png'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); });
        if (a.dataset.act === 'meta') navigator.clipboard.writeText(JSON.stringify(metadata(traits()), null, 2)).then(() => c.toast('Metadata copied'), () => c.toast('Copy blocked: copy it from the box below.'));
      });
      renderInfo(); loop();
      infoTimer = setInterval(renderInfo, 2000);
    },
    unmount() { cancelAnimationFrame(raf); clearInterval(infoTimer); el = null; },
    onStatus(st) {
      if (mem.day !== dayKey() && st.blockHeight !== null) { mem.day = dayKey(); mem.dayStartHeight = st.blockHeight; save(); }
    },
    onBlock() { mem.blocksSeen = (mem.blocksSeen || 0) + 1; save(); },
  });
})();
