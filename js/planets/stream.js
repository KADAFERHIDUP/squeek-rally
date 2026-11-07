/* Planet 4 · Broadcastia (Stream companions & overlays)
 * Transparent overlays for OBS (open index.html#overlay-compact, #overlay-full, #overlay-ticker or #overlay-poll
 * as a Browser Source), a big second-screen view of the wheel, and an audience poll: viewers open #vote on their
 * phones and call the next round (run or sleep?). The poll is settled by the round's on-chain settlement and the
 * live tally shows on the overlay. With the shared server everyone votes together; without it the streamer
 * tallies chat by hand on this screen. */
'use strict';
(() => {
  const SR = window.SR;
  let el = null, ctx = null, timer = 0, ovEl = null, ovMode = 'overlay-compact', ovTimer = 0;
  let poll = null, pollAt = 0, pollTimer = 0, pollErr = '';
  const SLEEP_BELOW = 5;

  // ---------------------------------------------------------------- audience poll
  const localPoll = () => {
    const c = ctx || SR.App.ctx, p = c.profile;
    p.stream = p.stream || { polls: {}, history: [] };
    return p.stream;
  };
  async function refreshPoll() {
    if (SR.Net && SR.Net.enabled()) {
      try { poll = await SR.Net.poll(); poll.shared = true; pollErr = ''; } catch (e) { pollErr = e.message; }
    } else {
      const s = localPoll(), open = SR.Data.currentRound() + 1;
      const t = s.polls[open] || { run: 0, sleep: 0 };
      const last = s.history[s.history.length - 1] || null;
      poll = { shared: false, question: `Round #${open}: will Squeektoshi run (≥ ${SLEEP_BELOW} m) or sleep?`, open: { round: open, run: t.run, sleep: t.sleep, mine: null }, last };
    }
    pollAt = Date.now();
  }
  function pollBars(t, big = false) {
    const n = (t.run || 0) + (t.sleep || 0), r = n ? Math.round(t.run / n * 100) : 50;
    return `<div class="poll ${big ? 'big' : ''}">
      <div class="poll-row"><span>🏃 Run</span><div class="bar" style="--pc:var(--ok)"><i style="width:${n ? r : 0}%"></i></div><b>${t.run || 0}</b></div>
      <div class="poll-row"><span>😴 Sleep</span><div class="bar" style="--pc:#b78cff"><i style="width:${n ? 100 - r : 0}%"></i></div><b>${t.sleep || 0}</b></div>
    </div>`;
  }
  const lastLine = l => l ? `Round #${l.round}: ${l.actual === 'run' ? 'ran' : 'slept'} ${(ctx || SR.App.ctx).fmtM(l.distanceM)} · chat said ${l.run}–${l.sleep}${l.crowdRight === null ? '' : l.crowdRight ? ' ✓' : ' ✗'}` : 'No poll settled yet';

  const STYLES = {
    'overlay-compact': { name: 'Compact', size: '420 × 120', desc: 'Spinning wheel, speed and the round clock.' },
    'overlay-full': { name: 'Full', size: '460 × 260', desc: 'Adds Squeek block progress, today\'s distance and the latest on-chain event.' },
    'overlay-ticker': { name: 'Ticker', size: '1280 × 60', desc: 'A one-line strip for the bottom of your scene.' },
    'overlay-poll': { name: 'Audience poll', size: '420 × 200', desc: 'Live run-or-sleep votes for the next round and how the last poll went.' },
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
    if (mode === 'overlay-poll') {
      if (!poll) return '<div class="ov"><span class="k">Loading poll…</span></div>';
      return `<div class="ov"><b>${c.esc(poll.question)}</b>${pollBars(poll.open)}
        <div class="ov-row" style="justify-content:space-between"><span class="k">${poll.shared ? 'Vote on your phone' : 'Vote in chat'}</span><span class="v">${clock} left</span></div>
        <div class="k">${c.esc(lastLine(poll.last))}</div></div>`;
    }
    return `<div class="ov">${head}
      <div class="ov-row" style="justify-content:space-between"><span class="k">Today</span><span class="v">${c.fmtM(st.todayM)}</span></div>
      <div><div class="ov-row" style="justify-content:space-between"><span class="k">Next Squeek block #${st.blockHeight === null ? '–' : st.blockHeight + 1}</span><span class="v">${(prog * 100).toFixed(1)}%</span></div>
      <div class="bar" style="margin-top:4px;--pc:var(--gold)"><i style="width:${prog * 100}%"></i></div></div>
      <div class="ov-row" style="justify-content:space-between"><span class="k">Latest on-chain</span><span class="v" style="text-transform:capitalize">${ev ? c.esc(ev.type) + (ev.at ? ' · ' + c.ago(ev.at) : '') : '–'}</span></div>
    </div>`;
  }

  /** OBS has its own browser storage, so the server address travels in the URL. */
  function overlayUrl(mode) {
    const srv = SR.Net && SR.Net.configured() ? `?server=${encodeURIComponent(SR.Net.base)}` : '';
    return `${location.origin}${location.pathname}${srv}#${mode}`;
  }

  function renderPoll() {
    const box = el && el.querySelector('[data-s="poll"]');
    if (!box || !poll) return;
    const shared = poll.shared, c = ctx;
    box.innerHTML = `
      <p><b>${c.esc(poll.question)}</b> <span class="pill">${c.fmtClock(SR.Data.secondsLeft())} to vote</span></p>
      ${pollBars(poll.open, true)}
      ${shared ? `
        <label class="small muted" for="vote-url">Viewers vote here (put it in chat or on screen)</label>
        <div class="row"><input class="input" id="vote-url" readonly style="flex:1" value="${c.esc(overlayUrl('vote'))}"><button type="button" class="btn" data-act="copy-vote">Copy</button></div>`
      : `<div class="row"><button type="button" class="btn" data-tally="run">+1 Run</button><button type="button" class="btn" data-tally="sleep">+1 Sleep</button><button type="button" class="btn" data-tally="reset">Reset</button></div>
        <p class="note">No shared server is set, so this poll lives on this screen: tally your chat with the buttons. Add a server in Rallyon → Settings and viewers can vote from their phones${pollErr ? ` (server: ${c.esc(pollErr)})` : ''}.</p>`}
      <p class="small">${c.esc(lastLine(poll.last))}</p>
      <p class="small muted">Settled from the round's on-chain settlement: run means ${SLEEP_BELOW} m or more.</p>`;
  }

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
            <h3>Audience poll <span class="tag">${SR.Net && SR.Net.enabled() ? 'shared' : 'this screen'}</span></h3>
            <div data-s="poll"><p class="empty">Loading…</p></div>
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
        const t = e.target.closest('[data-tally]');
        if (!t) return;
        const s = localPoll(), open = SR.Data.currentRound() + 1;
        const cur = s.polls[open] || { run: 0, sleep: 0 };
        if (t.dataset.tally === 'reset') delete s.polls[open];
        else s.polls[open] = { ...cur, [t.dataset.tally]: cur[t.dataset.tally] + 1 };
        c.saveProfile(); refreshPoll().then(() => { renderPoll(); render(); });
      });
      root.addEventListener('click', e => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'copy') navigator.clipboard.writeText(root.querySelector('[data-s="url"]').value).then(() => c.toast('Overlay URL copied'), () => c.toast('Copy blocked: select the URL and copy it.'));
        if (a.dataset.act === 'copy-vote') navigator.clipboard.writeText(root.querySelector('#vote-url').value).then(() => c.toast('Vote link copied'), () => c.toast('Copy blocked: select the link and copy it.'));
        if (a.dataset.act === 'full') { const card = a.closest('.card'); (card.requestFullscreen ? card.requestFullscreen() : Promise.reject()).catch(() => c.toast('Full screen is not available here.')); }
      });
      render();
      refreshPoll().then(renderPoll);
      timer = setInterval(() => { render(); if (Date.now() - pollAt > 5000) refreshPoll().then(renderPoll); else renderPoll(); }, 1000);
    },
    unmount() { clearInterval(timer); el = null; },
    /** Local polls are settled from on-chain round results, like every other call in Squeek Orbit. */
    onSettle(r) {
      const s = localPoll(), t = s.polls[r.round];
      if (!t) return;
      delete s.polls[r.round];
      if (r.complete) {
        const actual = r.distanceM >= SLEEP_BELOW ? 'run' : 'sleep', crowd = t.run === t.sleep ? null : t.run > t.sleep ? 'run' : 'sleep';
        s.history = [...s.history, { round: r.round, run: t.run, sleep: t.sleep, distanceM: r.distanceM, actual, crowdRight: crowd === null ? null : crowd === actual }].slice(-20);
      }
      (ctx || SR.App.ctx).saveProfile();
    },
    /** #vote: a phone-sized page where viewers call the next round. */
    mountVote(root, c) {
      ctx = c;
      const draw = async () => {
        await refreshPoll();
        if (!poll || !poll.shared) { root.innerHTML = `<div class="vote"><h2>Squeek Orbit poll</h2><p>${pollErr ? c.esc(pollErr) : 'This poll needs the shared server. Ask the streamer for the full vote link.'}</p></div>`; return; }
        root.innerHTML = `<div class="vote">
          <h2>🐹 ${c.esc(poll.question)}</h2>
          <p class="small muted">${c.fmtClock(SR.Data.secondsLeft())} left to vote · settled on-chain when the round ends</p>
          <div class="vote-btns"><button type="button" class="btn ${poll.open.mine === 'run' ? 'primary' : ''}" data-vote="run">🏃 Run</button><button type="button" class="btn ${poll.open.mine === 'sleep' ? 'primary' : ''}" data-vote="sleep">😴 Sleep</button></div>
          ${pollBars(poll.open, true)}
          <p class="small">${c.esc(lastLine(poll.last))}</p>
        </div>`;
      };
      root.addEventListener('click', async e => {
        const b = e.target.closest('[data-vote]');
        if (!b) return;
        try { await SR.Net.vote(poll.open.round, b.dataset.vote); c.toast('Vote counted'); } catch (err) { c.toast(err.message); }
        draw();
      });
      draw();
      setInterval(draw, 5000);
    },
    mountOverlay(root, c, mode) {
      ctx = c; ovEl = root; ovMode = STYLES[mode] ? mode : 'overlay-compact';
      const draw = () => { ovEl.innerHTML = widget(ovMode); };
      const needsPoll = ovMode === 'overlay-poll';
      if (needsPoll) refreshPoll().then(draw);
      draw();
      ovTimer = setInterval(() => { if (needsPoll && Date.now() - pollAt > 5000) refreshPoll(); draw(); }, 1000);
    },
  });
})();
