/* Planet 4 · Broadcastia (Stream companions & overlays)
 * Transparent overlays for OBS (open index.html#overlay-compact, #overlay-full or #overlay-ticker as a
 * Browser Source) and a big second-screen view of the wheel. */
'use strict';
(() => {
  const SR = window.SR;
  let el = null, ctx = null, timer = 0, ovEl = null, ovMode = 'overlay-compact', ovTimer = 0;

  const STYLES = {
    'overlay-compact': { name: 'Compact', size: '420 × 120', desc: 'Spinning wheel, speed and the round clock.' },
    'overlay-full': { name: 'Full', size: '460 × 260', desc: 'Adds Squeek block progress, today\'s distance and the latest on-chain event.' },
    'overlay-ticker': { name: 'Ticker', size: '1280 × 60', desc: 'A one-line strip for the bottom of your scene.' },
  };

  function widget(mode) {
    const D = SR.Data, st = D.state.status, c = ctx || SR.App.ctx;
    const spd = st.running ? `${Math.max(0.4, 60 / Math.max(st.rpm, 1)).toFixed(2)}s` : '0s';
    const prog = st.blockProgress === null ? 0 : st.blockProgress / 1e9;
    const ev = D.state.events[0];
    const wheel = `<span class="ov-wheel ${st.running ? 'spin' : ''}" style="--spd:${spd}"></span>`;
    const clock = `${c.fmtClock(D.secondsLeft())}`;
    if (mode === 'overlay-ticker') {
      return `<div class="ov" style="display:flex;align-items:center;gap:18px;min-width:0;padding:8px 16px;border-radius:12px">
        <b style="font-size:14px">🐹 Squeektoshi</b>
        <span class="v">${st.running ? `RUNNING ${st.speed.toFixed(2)} m/s · ${st.rpm.toFixed(0)} rpm` : 'RESTING'}</span>
        <span class="v">Today ${c.fmtM(st.todayM)}</span>
        <span class="v">Round #${D.currentRound()} · ${clock}</span>
        <span class="v">Block #${st.blockHeight ?? '–'} · ${(prog * 100).toFixed(0)}%</span>
      </div>`;
    }
    const head = `<div class="ov-row">${wheel}<div><b>${st.running ? 'Squeektoshi is running' : 'Squeektoshi is resting'}</b>
      <div class="v">${st.speed.toFixed(2)} m/s · ${st.rpm.toFixed(0)} rpm</div></div>
      <div style="margin-left:auto;text-align:right"><div class="k">Round #${D.currentRound()}</div><div class="v">${clock}</div></div></div>`;
    if (mode === 'overlay-compact') return `<div class="ov">${head}</div>`;
    return `<div class="ov">${head}
      <div class="ov-row" style="justify-content:space-between"><span class="k">Today</span><span class="v">${c.fmtM(st.todayM)}</span></div>
      <div><div class="ov-row" style="justify-content:space-between"><span class="k">Next Squeek block #${st.blockHeight === null ? '–' : st.blockHeight + 1}</span><span class="v">${(prog * 100).toFixed(1)}%</span></div>
      <div class="bar" style="margin-top:4px;--pc:var(--gold)"><i style="width:${prog * 100}%"></i></div></div>
      <div class="ov-row" style="justify-content:space-between"><span class="k">Latest on-chain</span><span class="v" style="text-transform:capitalize">${ev ? c.esc(ev.type) + (ev.at ? ' · ' + c.ago(ev.at) : '') : '–'}</span></div>
    </div>`;
  }

  function overlayUrl(mode) { return `${location.origin}${location.pathname}#${mode}`; }

  function render() {
    if (!el) return;
    const sel = el.querySelector('[data-s="style"]').value;
    el.querySelector('[data-s="preview"]').innerHTML = widget(sel);
    el.querySelector('[data-s="url"]').value = overlayUrl(sel);
    el.querySelector('[data-s="size"]').textContent = STYLES[sel].size;
    el.querySelector('[data-s="desc"]').textContent = STYLES[sel].desc;
    const D = SR.Data, st = D.state.status, c = ctx;
    const prog = st.blockProgress === null ? 0 : st.blockProgress / 1e9;
    el.querySelector('[data-s="big"]').innerHTML = `
      <div class="stat"><span class="k">Wheel</span><span class="v">${st.running ? 'Running' : 'Resting'}</span><span class="s">${st.coreStatus || '–'} · ${st.freshness || '–'}</span></div>
      <div class="stat"><span class="k">Speed</span><span class="v">${st.speed.toFixed(2)} m/s</span><span class="s">${st.rpm.toFixed(0)} rpm</span></div>
      <div class="stat"><span class="k">Today</span><span class="v">${c.fmtM(st.todayM)}</span><span class="s">12:00 to 12:00 UTC</span></div>
      <div class="stat"><span class="k">Round</span><span class="v">#${D.currentRound()}</span><span class="s">${c.fmtClock(D.secondsLeft())} left</span></div>
      <div class="stat"><span class="k">Squeek block</span><span class="v">#${st.blockHeight ?? '–'}</span><span class="s">${(prog * 100).toFixed(1)}% to next</span></div>
      <div class="stat"><span class="k">Settled through</span><span class="v">#${st.settledThrough ?? '–'}</span><span class="s">on Sepolia</span></div>
      <div class="stat"><span class="k">Lifetime turns</span><span class="v">${st.cumWork === null ? '–' : st.cumWork.toLocaleString('en-US')}</span><span class="s">≈ ${c.fmtM(st.cumWork === null ? null : st.cumWork * D.METRES_PER_WORK)}</span></div>
      <div class="stat"><span class="k">Last reading</span><span class="v">${st.observedAt ? c.ago(st.observedAt) : '–'}</span><span class="s">from the wheel sensor</span></div>`;
  }

  SR.App.register('stream', {
    mount(root, c) {
      ctx = c; el = root;
      root.innerHTML = `<div class="wrap">
        <div class="cols">
          <section class="card">
            <h3>Overlay builder <span class="tag">OBS · Streamlabs</span></h3>
            <label class="small muted" for="ov-style">Style</label>
            <select class="input" id="ov-style" data-s="style">${Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select>
            <p class="small" data-s="desc"></p>
            <div class="preview-frame" data-s="preview"></div>
            <label class="small muted" for="ov-url">Browser Source URL · suggested size <span class="mono" data-s="size"></span></label>
            <div class="row"><input class="input" id="ov-url" data-s="url" readonly style="flex:1"><button type="button" class="btn primary" data-act="copy">Copy</button></div>
            <ol class="how small">
              <li>In OBS, add a <b>Browser</b> source and paste the URL.</li>
              <li>Set the width and height above. The background is transparent.</li>
              <li>It updates every 4 seconds straight from Squeekchain's public API.</li>
            </ol>
            <p class="note">Overlays need this site to be hosted (for example GitHub Pages). They read the public API directly; nothing to log in to.</p>
          </section>
          <section class="card">
            <h3>Second screen <span class="tag">live</span></h3>
            <div class="grid4" data-s="big" style="grid-template-columns:repeat(2,1fr)"></div>
            <button type="button" class="btn" data-act="full">⛶ Full screen</button>
          </section>
        </div>
      </div>`;
      root.querySelector('[data-s="style"]').addEventListener('change', render);
      root.addEventListener('click', e => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'copy') navigator.clipboard.writeText(root.querySelector('[data-s="url"]').value).then(() => c.toast('Overlay URL copied'), () => c.toast('Copy blocked: select the URL and copy it.'));
        if (a.dataset.act === 'full') { const card = a.closest('.card'); (card.requestFullscreen ? card.requestFullscreen() : Promise.reject()).catch(() => c.toast('Full screen is not available here.')); }
      });
      render();
      timer = setInterval(render, 1000);
    },
    unmount() { clearInterval(timer); el = null; },
    mountOverlay(root, c, mode) {
      ctx = c; ovEl = root; ovMode = STYLES[mode] ? mode : 'overlay-compact';
      const draw = () => { ovEl.innerHTML = widget(ovMode); };
      draw();
      ovTimer = setInterval(draw, 1000);
    },
  });
})();
