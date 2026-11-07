/* Planet 5 · Vaultar (Utilities for holders)
 *
 * Read side: any address, from /v1/accounts/{address}: every Squeek, its level, power, custody and merge state,
 * the best same-level merges, and claimable rewards.
 *
 * Action side (non-custodial): connect your own wallet and Vaultar prepares real transactions for it:
 *   merge two wallet Squeeks           Squeek.merge(keep, burn)
 *   merge two staked Squeeks           Staking.mergeDeposited(collection, keep, burn)
 *   deposit one Squeek into staking    Squeek.safeTransferFrom(you, staking, id)
 *   deposit several                    Squeek.setApprovalForAll(staking, true) once, then Staking.deposit(collection, ids) in batches of 25
 *   claim and restake rewards          Staking.claimAndStake()
 * Contract addresses come from /v1/economy/state (cross-checked against each other), the chain must be Sepolia,
 * every call is simulated with eth_call first, and only a passing simulation can be sent to the wallet to sign.
 * Vaultar never asks for a private key or seed phrase and never signs anything itself. */
'use strict';
(() => {
  const SR = window.SR;
  const W = () => SR.Wallet;
  let el = null, ctx = null;
  let view = { addr: '', account: null, demo: false, raw: null };
  let desk = { queue: [], tx: null, sim: null, simKey: '', busy: false, hash: null, note: '' };
  let picked = new Set();
  const power = L => Math.round(1000 * Math.pow(2.2, L - 1));
  const BATCH = 25;

  const econ = () => SR.Data.state.economy || {};
  const contracts = () => econ().contracts || {};
  const me = () => W().state.account;
  const mine = () => !!me() && W().same(me(), view.addr);
  const keyOf = tx => tx ? `${tx.to}|${tx.data}|${me()}|${W().state.chainId}` : '';

  function readyOf(s, h) {
    if (s.mergeState) return String(s.mergeState).toLowerCase() === 'ready';
    return s.nextMergeHeight === null || (h !== null && s.nextMergeHeight <= h);
  }
  const custody = s => {
    if (s.burned) return 'burned';
    if (s.depositor && W().same(s.depositor, view.addr)) return 'staked';
    if (s.depositor) return 'staked';
    return 'wallet';
  };

  /** Same-level pairs off cooldown, in the same custody (both in the wallet, or both staked). */
  function pairs(squeeks, height) {
    const groups = {};
    for (const s of squeeks) {
      if (!s.level || s.burned || s.level >= (econ().maxLevel || 10) || !readyOf(s, height)) continue;
      const k = `${s.level}|${custody(s)}`;
      (groups[k] = groups[k] || []).push(s);
    }
    const out = [];
    for (const [k, list] of Object.entries(groups)) {
      const [L, where] = k.split('|');
      list.sort((a, b) => a.id - b.id);
      for (let i = 0; i + 1 < list.length; i += 2) out.push({ level: Number(L), where, keep: list[i], burn: list[i + 1], gain: power(Number(L) + 1) - 2 * power(Number(L)) });
    }
    return out.sort((a, b) => b.gain - a.gain || a.keep.id - b.keep.id);
  }

  // ---------------------------------------------------------------- gates (why an action is not available)
  function blocked(kind) {
    const e = econ(), c = contracts();
    if (SR.Data.state.mode === 'demo') return 'Demo data is showing because the Squeekchain API is unreachable. Actions are off.';
    if (!c.collection || !c.staking) return 'Waiting for contract addresses from /economy/state…';
    if (c.consistent === false) return 'The contract addresses from /economy/state do not agree with each other, so Vaultar will not prepare transactions.';
    if (!me()) return 'Connect your wallet to prepare this.';
    if (!mine()) return 'You are viewing another address. Actions only work on the wallet you connected.';
    if (W().state.chainId !== W().SEPOLIA) return 'Your wallet is not on Sepolia.';
    if (kind === 'merge' && e.mergesOpen === false) return 'Merges are closed on-chain right now (the collection reports mergesOpen = false). This unlocks by itself when Squeekchain opens merges.';
    if ((kind === 'deposit' || kind === 'claim') && e.stakingPaused) return 'The staking contract is paused.';
    return null;
  }

  // ---------------------------------------------------------------- wallet card
  function renderWallet() {
    const box = el && el.querySelector('[data-v="wallet"]');
    if (!box) return;
    const w = W().state, list = W().available();
    const onSepolia = w.chainId === W().SEPOLIA;
    const c = contracts();
    box.innerHTML = `
      <h3>Your wallet <span class="tag">non-custodial</span></h3>
      ${w.account ? `
        <div class="row" style="align-items:center">
          <span class="pill ${onSepolia ? 'ok' : 'bad'}">${onSepolia ? 'Sepolia' : `Wrong network (${w.chainId})`}</span>
          <span class="mono">${ctx.esc(W().short(w.account))}</span><span class="small muted">via ${ctx.esc(w.name || 'wallet')}</span>
          ${onSepolia ? '' : '<button type="button" class="btn primary" data-w="switch">Switch to Sepolia</button>'}
          <button type="button" class="btn" data-w="disconnect">Disconnect</button>
        </div>` : list.length ? `
        <p class="small">Connect to prepare merges, staking deposits and reward claims for your own Squeeks. You review and sign everything in your wallet.</p>
        <div class="row">${list.map(x => `<button type="button" class="btn primary" data-w="connect" data-id="${ctx.esc(x.id)}">${x.icon && /^data:image\//.test(x.icon) ? `<img src="${ctx.esc(x.icon)}" alt="" width="18" height="18" style="vertical-align:-4px;margin-right:6px">` : ''}Connect ${ctx.esc(x.name)}</button>`).join('')}</div>` : `
        <p class="small">No wallet was found in this browser. Install an EVM wallet such as MetaMask or Rabby to use actions. You can still check any address below.</p>`}
      <ul class="how small">
        <li>Vaultar never asks for your seed phrase or private key. Nobody legitimate ever will.</li>
        <li>Contracts are read from Squeekchain's <span class="mono">/economy/state</span>: Squeek collection ${c.collection ? `<a href="${W().EXPLORER}/address/${c.collection}" target="_blank" rel="noopener" class="mono">${W().short(c.collection)}</a>` : '–'}, staking ${c.staking ? `<a href="${W().EXPLORER}/address/${c.staking}" target="_blank" rel="noopener" class="mono">${W().short(c.staking)}</a>` : '–'}${c.consistent === false ? ' <span class="pill bad">mismatch</span>' : c.consistent ? ' <span class="pill ok">cross-checked</span>' : ''}.</li>
        <li>Every transaction is simulated against the live contract first. If the simulation fails, it cannot be sent.</li>
      </ul>`;
  }

  // ---------------------------------------------------------------- transaction desk
  function renderDesk() {
    const box = el && el.querySelector('[data-v="desk"]');
    if (!box) return;
    const tx = desk.tx;
    if (!tx) {
      box.innerHTML = `<h3>Transaction desk</h3><p class="empty">Pick an action: a merge pair, a deposit, or claiming rewards. It will appear here to simulate and sign.</p>${desk.note ? `<p class="note">${desk.note}</p>` : ''}`;
      return;
    }
    const c = contracts();
    const which = W().same(tx.to, c.staking) ? 'Staking' : W().same(tx.to, c.collection) ? 'Squeek collection' : 'Contract';
    const simOk = desk.sim && desk.sim.ok && desk.simKey === keyOf(tx);
    const left = desk.queue.length;
    box.innerHTML = `
      <h3>Transaction desk ${left ? `<span class="tag">step ${desk.step} of ${desk.step + left}</span>` : ''}</h3>
      <p><b>${ctx.esc(tx.label)}</b></p>
      ${tx.warn ? `<p class="note">${tx.warn}</p>` : ''}
      <ul class="list">
        <li><span class="k">Contract</span><span>${which}</span><a class="mono" href="${W().EXPLORER}/address/${tx.to}" target="_blank" rel="noopener">${W().short(tx.to)}</a></li>
        <li><span class="k">Function</span><span class="mono">${ctx.esc(tx.sig)}</span><span></span></li>
        ${tx.args.map(([t, v]) => `<li><span class="k mono">${t}</span><span class="mono">${ctx.esc(Array.isArray(v) ? `[${v.join(', ')}]` : String(v))}</span><span></span></li>`).join('')}
        <li><span class="k">Value</span><span>0 ETH</span><span class="small muted">gas only</span></li>
      </ul>
      <details><summary class="small">Calldata (what your wallet will show)</summary><pre class="raw">${tx.data}</pre></details>
      <div class="row">
        <button type="button" class="btn" data-d="sim" ${desk.busy ? 'disabled' : ''}>1 · Simulate</button>
        <button type="button" class="btn primary" data-d="send" ${desk.busy || !simOk ? 'disabled' : ''}>2 · Sign in wallet</button>
        <button type="button" class="btn" data-d="cancel" ${desk.busy ? 'disabled' : ''}>Cancel</button>
      </div>
      <p class="small" data-d="status">${deskStatus(tx, simOk)}</p>`;
  }
  function deskStatus(tx, simOk) {
    if (desk.hash) return `Sent: <a class="mono" href="${W().EXPLORER}/tx/${desk.hash}" target="_blank" rel="noopener">${W().short(desk.hash)}</a> · ${desk.note || 'waiting for confirmation…'}`;
    if (desk.busy) return desk.note || 'Working…';
    if (desk.sim && desk.simKey === keyOf(tx)) return desk.sim.ok ? `<span style="color:var(--ok)">✓ Simulation passed</span> · about ${desk.sim.gas.toLocaleString('en-US')} gas. Your wallet will ask you to confirm.` : `<span style="color:var(--bad)">✗ ${ctx.esc(desk.sim.reason)}</span> Nothing was sent.`;
    return 'Simulate first. Vaultar runs the exact call against the live contract without sending it.';
  }

  function stage(list, note = '') {
    desk = { queue: list.slice(1), tx: list[0] || null, sim: null, simKey: '', busy: false, hash: null, note, step: 1 };
    renderDesk();
    const box = el && el.querySelector('[data-v="desk"]');
    if (box && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function simulate() {
    const tx = desk.tx;
    if (!tx) return;
    desk.busy = true; desk.note = 'Simulating with eth_call…'; renderDesk();
    try { desk.sim = await W().simulate(tx.to, tx.data); }
    catch (e) { desk.sim = { ok: false, reason: e.message || W().reason(e) }; }
    desk.simKey = keyOf(tx); desk.busy = false; desk.note = ''; renderDesk();
  }

  async function send() {
    const tx = desk.tx;
    if (!tx || !(desk.sim && desk.sim.ok && desk.simKey === keyOf(tx))) return;
    desk.busy = true; desk.note = 'Waiting for you to confirm in your wallet…'; renderDesk();
    try {
      desk.hash = await W().send(tx.to, tx.data);
      desk.note = 'waiting for confirmation…'; renderDesk();
      const r = await W().waitReceipt(desk.hash);
      if (r.ok) {
        ctx.toast(`${tx.label}: confirmed in block ${r.block}`, 'win');
        const next = desk.queue.shift();
        if (next) { const step = desk.step + 1; desk = { ...desk, tx: next, sim: null, simKey: '', busy: false, hash: null, note: '', step }; renderDesk(); }
        else { desk = { queue: [], tx: null, sim: null, simKey: '', busy: false, hash: null, note: `Done: <a class="mono" href="${W().EXPLORER}/tx/${r.receipt.transactionHash || ''}" target="_blank" rel="noopener">view on Etherscan</a>.` }; picked.clear(); renderDesk(); }
        setTimeout(() => lookup(view.addr), 4000);
      } else if (r.ok === false) { desk.busy = false; desk.note = '<span style="color:var(--bad)">The transaction reverted on-chain.</span>'; renderDesk(); }
      else { desk.busy = false; desk.note = 'Still pending after 3 minutes. Check it on Etherscan.'; renderDesk(); }
    } catch (e) {
      desk.busy = false; desk.hash = null; desk.note = ''; desk.sim = { ok: false, reason: W().reason(e) }; renderDesk();
    }
  }

  // ---------------------------------------------------------------- preparing actions
  function prepareMerge(keepId, burnId, where) {
    const why = blocked('merge');
    if (why) { ctx.toast(why); return; }
    const c = contracts();
    const tx = where === 'staked' ? W().build.mergeDeposited(c, keepId, burnId) : W().build.merge(c, keepId, burnId);
    tx.warn = `Squeek #${burnId} is burned for good. #${keepId} keeps its ID and image and goes up one level.`;
    stage([tx]);
  }

  async function prepareDeposit() {
    const why = blocked('deposit');
    if (why) { ctx.toast(why); return; }
    const ids = [...picked].sort((a, b) => a - b);
    if (!ids.length) { ctx.toast('Tick the Squeeks you want to deposit first.'); return; }
    const c = contracts();
    if (ids.length === 1) { stage([W().build.depositOne(c, me(), ids[0])], ''); return; }
    let approved = false;
    try { approved = await W().reads.isApprovedForAll(c.collection, me(), c.staking); } catch { approved = false; }
    const steps = [];
    if (!approved) {
      const a = W().build.approveStaking(c);
      a.warn = 'This lets the official staking contract (address above, from /economy/state) move your Squeeks so it can take several in one deposit. You can turn it off later with setApprovalForAll(staking, false).';
      steps.push(a);
    }
    for (let i = 0; i < ids.length; i += BATCH) steps.push(W().build.deposit(c, ids.slice(i, i + BATCH)));
    stage(steps);
  }

  function prepareClaim() {
    const why = blocked('claim');
    if (why) { ctx.toast(why); return; }
    stage([W().build.claimAndStake(contracts())]);
  }

  // ---------------------------------------------------------------- read side
  async function lookup(addr) {
    const out = el && el.querySelector('[data-v="out"]');
    if (!out) return;
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { out.innerHTML = '<p class="empty">That does not look like an Ethereum address (0x followed by 40 hex characters).</p>'; return; }
    ctx.profile.vaultAddress = addr; ctx.saveProfile();
    if (!W().same(addr, view.addr)) picked.clear();
    view.addr = addr;
    out.innerHTML = '<p class="empty">Reading Squeekchain…</p>';
    try {
      const { demo, raw, account } = await SR.Data.fetchAccount(addr);
      view = { addr, account, demo, raw };
      renderAccount();
    } catch (err) {
      out.innerHTML = `<p class="empty">Could not read that wallet (${ctx.esc(err.message)}). Check the address, or try again in a moment.</p>`;
    }
  }

  function renderAccount() {
    const out = el && el.querySelector('[data-v="out"]');
    if (!out || !view.account) return;
    const { account, demo, raw } = view;
    const h = account.coreBlockHeight ?? SR.Data.state.status.blockHeight;
    const sq = [...account.squeeks].sort((a, b) => (b.level || 0) - (a.level || 0) || a.id - b.id);
    const totalPower = sq.reduce((a, s) => a + (s.burned ? 0 : (s.power || 0)), 0);
    const pr = pairs(sq, h);
    const e = econ();
    const mergeWhy = blocked('merge'), depWhy = blocked('deposit'), claimWhy = blocked('claim');
    const held = sq.filter(s => custody(s) === 'wallet');
    out.innerHTML = `
      ${demo ? '<p class="note">Demo data: the Squeekchain API could not be reached from here.</p>' : ''}
      <div class="grid4">
        <div class="stat"><span class="k">Squeeks</span><span class="v">${sq.length}</span><span class="s">${sq.filter(s => custody(s) === 'staked').length} in staking</span></div>
        <div class="stat"><span class="k">NFT power</span><span class="v">${totalPower.toLocaleString('en-US')}</span><span class="s">1,000 × 2.2^(level − 1) each</span></div>
        <div class="stat"><span class="k">Claimable</span><span class="v">${account.claimable !== null ? SR.Data.formatUnits(account.claimable, e.decimals ?? 18, 2) ?? '–' : '–'}</span><span class="s">SQK</span></div>
        <div class="stat"><span class="k">Merge pairs ready</span><span class="v">${pr.length}</span><span class="s">${pr.length ? '+' + pr.reduce((a, p) => a + p.gain, 0).toLocaleString('en-US') + ' power' : 'none right now'}</span></div>
      </div>
      <div class="cols">
        <section class="card">
          <h3>Squeeks ${mine() ? '<span class="tag">tick to deposit</span>' : ''}</h3>
          <ul class="list" style="max-height:420px">${sq.length ? sq.map(s => {
            const left = s.nextMergeHeight !== null && h !== null ? s.nextMergeHeight - h : null;
            const where = custody(s);
            const state = readyOf(s, h) ? '<span class="pill ok">merge ready</span>' : left !== null ? `<span class="pill">${left.toLocaleString('en-US')} blocks</span>` : `<span class="pill">${ctx.esc(s.mergeState || 'unknown')}</span>`;
            const box = mine() && where === 'wallet' ? `<input type="checkbox" data-pick="${s.id}" ${picked.has(s.id) ? 'checked' : ''} aria-label="Deposit Squeek #${s.id}">` : `<span class="mono muted">#${s.id ?? '?'}</span>`;
            return `<li>${box}<span>${mine() && where === 'wallet' ? `<span class="mono muted">#${s.id}</span> ` : ''}${ctx.esc(ctx.profile.names[s.id] || s.name)} · L${s.level ?? '?'} · ${(s.power || 0).toLocaleString('en-US')} power · ${where}</span>${state}</li>`;
          }).join('') : '<li class="empty">No Squeeks found for this address.</li>'}</ul>
          ${mine() ? `<div class="row"><button type="button" class="btn primary" data-a="deposit" ${depWhy || !held.length ? 'disabled' : ''}>Deposit ${picked.size || ''} into staking</button>
            <button type="button" class="btn" data-a="all" ${held.length ? '' : 'disabled'}>Tick all in wallet</button></div>
            ${depWhy ? `<p class="small muted">${depWhy}</p>` : ''}` : ''}
        </section>
        <section class="card">
          <h3>Merge planner</h3>
          <p class="small muted">Two same-level Squeeks off cooldown merge into one a level higher: the survivor keeps its ID and image, the donor burns. Power grows ×2.2 per level, so each merge adds about 10%. Pairs must be in the same place (both in your wallet, or both staked).</p>
          <ul class="list">${pr.length ? pr.map(p => `<li><span class="pill hot">L${p.level}→L${p.level + 1}</span><span>keep #${p.keep.id}, burn #${p.burn.id} · ${p.where} · <b style="color:var(--ok)">+${p.gain.toLocaleString('en-US')}</b></span>${mine() ? `<button type="button" class="btn" data-merge="${p.keep.id},${p.burn.id},${p.where}" ${mergeWhy ? 'disabled' : ''}>Prepare</button>` : ''}</li>`).join('') : '<li class="empty">No pairs are ready to merge.</li>'}</ul>
          ${mine() && mergeWhy ? `<p class="note">${mergeWhy}</p>` : ''}
          ${mine() ? `<h3 style="margin-top:14px">Rewards</h3><div class="row"><button type="button" class="btn" data-a="claim" ${claimWhy ? 'disabled' : ''}>Claim and stake rewards</button></div>${claimWhy ? `<p class="small muted">${claimWhy}</p>` : '<p class="small muted">Claims your SQK staking rewards and stakes them straight back in, raising your SQK power.</p>'}` : ''}
        </section>
      </div>
      <details class="card"><summary>Raw API response</summary><pre class="raw">${ctx.esc(JSON.stringify(raw, null, 2) || 'demo')}</pre></details>`;
  }

  function rerender() { renderWallet(); renderAccount(); renderDesk(); }

  SR.App.register('vault', {
    mount(root, c) {
      ctx = c; el = root;
      root.innerHTML = `<div class="wrap">
        <div class="cols">
          <section class="card" data-v="wallet"></section>
          <section class="card" data-v="desk"></section>
        </div>
        <section class="card">
          <h3>Holder check</h3>
          <p>Paste any address to see its Squeeks, power, merge readiness and the best merges to make next. Connected wallets fill in automatically.</p>
          <form class="row" data-v="form"><input class="input" data-v="addr" placeholder="0x…" autocomplete="off" spellcheck="false" style="flex:1;min-width:240px" value="${c.esc(c.profile.vaultAddress || '')}"><button class="btn primary" type="submit">Check address</button></form>
          <div class="grid4" style="margin-top:6px">${[1, 2, 3, 4].map(L => `<div class="stat"><span class="k">Level ${L} power</span><span class="v">${power(L).toLocaleString('en-US')}</span></div>`).join('')}</div>
          <p class="small muted">Power per level from the Squeekchain docs: 1,000 × 2.2^(level − 1), up to level 10 (${power(10).toLocaleString('en-US')}).</p>
        </section>
        <div data-v="out" style="display:grid;gap:16px"></div>
      </div>`;
      root.querySelector('[data-v="form"]').addEventListener('submit', e => { e.preventDefault(); lookup(root.querySelector('[data-v="addr"]').value.trim()); });
      root.addEventListener('change', e => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        const id = Number(b.dataset.pick);
        b.checked ? picked.add(id) : picked.delete(id);
        const btn = root.querySelector('[data-a="deposit"]');
        if (btn) btn.textContent = `Deposit ${picked.size || ''} into staking`;
      });
      root.addEventListener('click', async e => {
        const w = e.target.closest('[data-w]'), d = e.target.closest('[data-d]'), a = e.target.closest('[data-a]'), m = e.target.closest('[data-merge]');
        try {
          if (w && w.dataset.w === 'connect') {
            await W().connect(w.dataset.id);
            const input = root.querySelector('[data-v="addr"]');
            input.value = me();
            lookup(me());
          }
          if (w && w.dataset.w === 'switch') await W().switchToSepolia();
          if (w && w.dataset.w === 'disconnect') { W().disconnect(); desk = { queue: [], tx: null }; }
        } catch (err) { c.toast(W().reason(err)); }
        if (d && d.dataset.d === 'sim') simulate();
        if (d && d.dataset.d === 'send') send();
        if (d && d.dataset.d === 'cancel') stage([]);
        if (m) { const [k, b, where] = m.dataset.merge.split(','); prepareMerge(Number(k), Number(b), where); }
        if (a && a.dataset.a === 'deposit') prepareDeposit();
        if (a && a.dataset.a === 'claim') prepareClaim();
        if (a && a.dataset.a === 'all') { view.account.squeeks.filter(s => custody(s) === 'wallet').forEach(s => picked.add(s.id)); renderAccount(); }
        if (w || a || m) rerender();
      });
      rerender();
      const start = me() || c.profile.vaultAddress;
      if (start) lookup(start);
    },
    unmount() { el = null; },
    onEconomy() { if (el) rerender(); },
  });
  // wallet events (account or network switched in the wallet)
  if (SR.Wallet) SR.Wallet.onChange(() => { if (el) { if (me() && !W().same(me(), view.addr)) { const i = el.querySelector('[data-v="addr"]'); if (i) i.value = me(); lookup(me()); } rerender(); } });
})();
