/* Planet 7 · Fintopia (SqueekFi)
 * 1. Staking-share calculator using the Proof of Squeek formulas from the docs:
 *      NFT power P = Σ round(1000 × 2.2^(L−1));  SQK power Q = S / c × (1 + P / P_ref), c = 40, P_ref = 1000
 *      share of each reward = (P + Q) / (total NFT power + total SQK power), totals from /v1/economy/state.
 *    The docs mark staking parameters as still in development, so results are estimates.
 * 2. A play-money prediction market on the next round's distance (no real value, no wallet). */
'use strict';
(() => {
  const SR = window.SR;
  let el = null, ctx = null, timer = 0;
  const C = 40, P_REF = 1000;
  const power = L => Math.round(1000 * Math.pow(2.2, L - 1));
  const big = v => { try { return v === null || v === undefined ? null : Number(BigInt(String(v))); } catch { return null; } };

  function calc() {
    const counts = [...el.querySelectorAll('[data-lv]')].map(i => Math.max(0, Math.floor(Number(i.value) || 0)));
    const S = Math.max(0, Number(el.querySelector('[data-f="sqk"]').value) || 0);
    const P = counts.reduce((a, n, i) => a + n * power(i + 1), 0);
    const Q = S / C * (1 + P / P_REF);
    const e = SR.Data.state.economy;
    const decimals = e?.decimals ?? 18;
    const tN = big(e?.totalNftPower), tQraw = big(e?.totalSqkPower);
    // totalSqkPower may be reported in base units; scale it down when it is clearly in base units
    const tQ = tQraw === null ? null : tQraw > 1e15 ? tQraw / 10 ** decimals : tQraw;
    const mine = P + Q;
    const share = tN !== null && tQ !== null ? mine / (tN + tQ + mine) : null;
    el.querySelector('[data-f="out"]').innerHTML = `
      <div class="stat"><span class="k">Your NFT power</span><span class="v">${Math.round(P).toLocaleString('en-US')}</span></div>
      <div class="stat"><span class="k">Your SQK power</span><span class="v">${Math.round(Q).toLocaleString('en-US')}</span><span class="s">${S.toLocaleString('en-US')} SQK × (1 + P/1000) ÷ 40</span></div>
      <div class="stat"><span class="k">Share of rewards</span><span class="v">${share === null ? '–' : (share * 100).toFixed(share < 0.001 ? 4 : 2) + '%'}</span><span class="s">${share === null ? 'network totals not available' : 'of each staking reward'}</span></div>`;
    const tips = [];
    const L1 = counts[0];
    if (L1 >= 2) tips.push(`Merging ${Math.floor(L1 / 2) * 2} level-1 Squeeks into level 2 adds ${(Math.floor(L1 / 2) * (power(2) - 2 * power(1))).toLocaleString('en-US')} NFT power (+10%).`);
    if (P > 0 && S === 0) tips.push(`Staking SQK multiplies with your NFT power: 1,000 SQK would add ${Math.round(1000 / C * (1 + P / P_REF)).toLocaleString('en-US')} power.`);
    if (P === 0) tips.push('Add your Squeeks by level to see your share.');
    el.querySelector('[data-f="tips"]').innerHTML = tips.map(t => `<li>${t}</li>`).join('');
  }

  // ---------------------------------------------------------------- play-money market
  function line() {
    const d = SR.Data.state.rounds.map(r => r.distanceM).filter(v => v >= 0).sort((a, b) => a - b);
    return d.length >= 5 ? Math.max(10, Math.round(d[Math.floor(d.length / 2)] / 10) * 10) : 150;
  }
  let sig = '';
  function renderMarket() {
    const p = ctx.profile.fi, next = SR.Data.currentRound() + 1, L = line();
    const bet = p.bets[next];
    const clock = el.querySelector('[data-f="clock"]');
    if (clock) clock.textContent = ctx.fmtClock(SR.Data.secondsLeft());
    const nextSig = JSON.stringify([next, L, bet, p.balance, (p.history || []).length]);
    if (nextSig === sig) return;
    sig = nextSig;
    el.querySelector('[data-f="bal"]').textContent = `${p.balance.toLocaleString('en-US')} pSQK`;
    el.querySelector('[data-f="mkt"]').innerHTML = `
      <p>Round <b>#${next}</b> (starts in <span data-f="clock">${ctx.fmtClock(SR.Data.secondsLeft())}</span>): will Squeektoshi run more or less than <b style="color:var(--pc)">${L} m</b>?</p>
      ${bet ? `<p class="pill hot">Your bet: ${bet.amount} pSQK on ${bet.side.toUpperCase()} ${bet.line} m</p>` : `
      <div class="row">
        <select class="input" data-f="amt" style="width:auto">${[50, 100, 250, 500].map(a => `<option ${a > p.balance ? 'disabled' : ''}>${a}</option>`).join('')}</select>
        <button type="button" class="btn primary" data-bet="over">Over ${L} m · pays ×1.9</button>
        <button type="button" class="btn" data-bet="under">Under ${L} m · pays ×1.9</button>
      </div>`}
      <p class="small muted">The line is the median of rounds this device has watched. Settled from the wheel's work counter when the round ends. Play money only: pSQK has no value and cannot be withdrawn.</p>`;
    const hist = (p.history || []).slice(-6).reverse();
    el.querySelector('[data-f="hist"]').innerHTML = hist.length ? hist.map(h => `<li><span class="mono muted">#${h.round}</span><span>${h.side} ${h.line} m · actual ${ctx.fmtM(h.actual)}</span><span class="pill ${h.win ? 'ok' : 'bad'}">${h.win ? '+' : '−'}${h.win ? Math.round(h.amount * 0.9) : h.amount}</span></li>`).join('') : '<li class="empty">No bets settled yet.</li>';
  }

  SR.App.register('fi', {
    mount(root, c) {
      ctx = c; el = root;
      root.innerHTML = `<div class="wrap">
        <div class="cols">
          <section class="card">
            <h3>Staking share calculator <span class="tag">Proof of Squeek</span></h3>
            <p class="small muted">How many Squeeks do you hold at each level, and how much SQK would you stake?</p>
            <div class="grid4">${[1, 2, 3, 4, 5, 6, 7, 8].map(L => `<label class="stat"><span class="k">Level ${L}</span><input class="input" type="number" min="0" value="${L === 1 ? 2 : 0}" data-lv="${L}"></label>`).join('')}</div>
            <label class="small muted" for="fi-sqk">SQK to stake</label>
            <input class="input" id="fi-sqk" type="number" min="0" step="100" value="0" data-f="sqk">
            <div class="grid3" data-f="out"></div>
            <ul class="how small" data-f="tips"></ul>
            <p class="note">Formulas from docs.squeekchain.com (c = 40 SQK, P_ref = 1,000). Staking is still in development there, so treat this as an estimate. Not financial advice.</p>
          </section>
          <section class="card">
            <h3>Round market <span class="tag" data-f="bal"></span></h3>
            <div data-f="mkt"></div>
            <ul class="list" data-f="hist"></ul>
            <button type="button" class="btn" data-act="refill">Refill to 1,000 pSQK</button>
          </section>
        </div>
      </div>`;
      root.addEventListener('input', e => { if (e.target.matches('[data-lv], [data-f="sqk"]')) calc(); });
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-bet]'), a = e.target.closest('[data-act]');
        const p = c.profile.fi;
        if (b) {
          const next = SR.Data.currentRound() + 1, amount = Number(root.querySelector('[data-f="amt"]').value);
          if (amount > p.balance) { c.toast('Not enough pSQK.'); return; }
          p.balance -= amount;
          p.bets[next] = { side: b.dataset.bet, amount, line: line() };
          c.saveProfile(); c.toast(`Bet placed on round #${next}`); renderMarket();
        }
        if (a && a.dataset.act === 'refill') { p.balance = Math.max(p.balance, 1000); c.saveProfile(); renderMarket(); }
      });
      sig = ''; calc(); renderMarket();
      timer = setInterval(renderMarket, 1000);
    },
    unmount() { clearInterval(timer); el = null; },
    onEconomy() { if (el) calc(); },
    onRound(r) {
      const c = ctx || SR.App.ctx, p = c.profile.fi;
      const bet = p.bets[r.round];
      if (!bet) return;
      delete p.bets[r.round];
      if (!r.complete) { p.balance += bet.amount; c.saveProfile(); c.toast(`Round #${r.round} was not fully watched: bet refunded.`); return; }
      const win = bet.side === 'over' ? r.distanceM > bet.line : r.distanceM < bet.line;
      if (win) p.balance += Math.round(bet.amount * 1.9);
      p.history = [...(p.history || []), { round: r.round, side: bet.side, line: bet.line, amount: bet.amount, actual: r.distanceM, win }].slice(-30);
      c.saveProfile();
      c.toast(`Market #${r.round}: ${c.fmtM(r.distanceM)} → ${win ? `won ${Math.round(bet.amount * 0.9)} pSQK` : 'lost'}`, win ? 'win' : 'lose');
      if (el) renderMarket();
    },
  });
})();
