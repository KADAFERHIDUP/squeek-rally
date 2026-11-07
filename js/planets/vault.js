/* Planet 5 · Vaultar (Utilities for holders)
 * Read-only wallet check from /v1/accounts/{address}: every Squeek, its level, power and merge state,
 * which same-level pairs can merge now, and what merging would add. Never connects a wallet or signs. */
'use strict';
(() => {
  const SR = window.SR;
  let el = null, ctx = null;
  const power = L => Math.round(1000 * Math.pow(2.2, L - 1));

  function pairs(squeeks, height) {
    const byLevel = {};
    for (const s of squeeks) {
      if (!s.level || s.burned) continue;
      const ready = s.mergeState ? String(s.mergeState).toLowerCase() === 'ready' : (s.nextMergeHeight === null || (height !== null && s.nextMergeHeight <= height));
      (byLevel[s.level] = byLevel[s.level] || []).push({ ...s, ready });
    }
    const out = [];
    for (const [L, list] of Object.entries(byLevel)) {
      const ready = list.filter(s => s.ready).sort((a, b) => a.id - b.id);
      for (let i = 0; i + 1 < ready.length; i += 2) out.push({ level: Number(L), keep: ready[i], burn: ready[i + 1], gain: power(Number(L) + 1) - 2 * power(Number(L)) });
    }
    return out.sort((a, b) => b.gain - a.gain);
  }

  async function lookup(addr) {
    const out = el.querySelector('[data-v="out"]');
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { out.innerHTML = '<p class="empty">That does not look like an Ethereum address (0x followed by 40 hex characters).</p>'; return; }
    ctx.profile.vaultAddress = addr; ctx.saveProfile();
    out.innerHTML = '<p class="empty">Reading Squeekchain…</p>';
    try {
      const { demo, raw, account } = await SR.Data.fetchAccount(addr);
      const h = account.coreBlockHeight ?? SR.Data.state.status.blockHeight;
      const sq = account.squeeks;
      const totalPower = sq.reduce((a, s) => a + (s.power || 0), 0);
      const pr = pairs(sq, h);
      const e = SR.Data.state.economy;
      out.innerHTML = `
        ${demo ? '<p class="note">Demo data: the Squeekchain API could not be reached from here.</p>' : ''}
        <div class="grid4">
          <div class="stat"><span class="k">Squeeks</span><span class="v">${sq.length}</span><span class="s">${sq.filter(s => s.depositor).length} in staking</span></div>
          <div class="stat"><span class="k">NFT power</span><span class="v">${totalPower.toLocaleString('en-US')}</span><span class="s">sum of levels</span></div>
          <div class="stat"><span class="k">Claimable</span><span class="v">${account.claimable !== null ? SR.Data.formatUnits(account.claimable, e?.decimals ?? 18, 2) ?? '–' : '–'}</span><span class="s">SQK</span></div>
          <div class="stat"><span class="k">Merge pairs ready</span><span class="v">${pr.length}</span><span class="s">${pr.length ? '+' + pr.reduce((a, p) => a + p.gain, 0).toLocaleString('en-US') + ' power' : 'none right now'}</span></div>
        </div>
        <div class="cols">
          <section class="card">
            <h3>Your Squeeks</h3>
            <ul class="list" style="max-height:420px">${sq.length ? sq.sort((a, b) => b.level - a.level).map(s => {
              const left = s.nextMergeHeight !== null && h !== null ? s.nextMergeHeight - h : null;
              const state = String(s.mergeState || '').toLowerCase() === 'ready' || (left !== null && left <= 0) ? '<span class="pill ok">merge ready</span>'
                : left !== null ? `<span class="pill">${left.toLocaleString('en-US')} blocks</span>` : `<span class="pill">${ctx.esc(s.mergeState || 'unknown')}</span>`;
              return `<li><span class="mono muted">#${s.id ?? '?'}</span><span>${ctx.esc(ctx.profile.names[s.id] || s.name)} · L${s.level ?? '?'} · ${(s.power || 0).toLocaleString('en-US')} power${s.depositor ? ' · staked' : ''}</span>${state}</li>`;
            }).join('') : '<li class="empty">No Squeeks found for this address.</li>'}</ul>
          </section>
          <section class="card">
            <h3>Merge planner <span class="tag">read-only</span></h3>
            <p class="small muted">Two same-level Squeeks off cooldown can merge into one a level higher. The survivor keeps its ID and image; the donor burns. Power grows ×2.2 per level, so each merge adds about 10%.</p>
            <ul class="list">${pr.length ? pr.map(p => `<li><span class="pill hot">L${p.level}→L${p.level + 1}</span><span>keep #${p.keep.id}, burn #${p.burn.id}</span><span class="mono" style="color:var(--ok)">+${p.gain.toLocaleString('en-US')}</span></li>`).join('') : '<li class="empty">No pairs are ready to merge.</li>'}</ul>
            <p class="note">Merging is done in the official Squeekchain app with your own wallet. Vaultar only reads public data and never asks for a signature.</p>
          </section>
        </div>
        <details class="card"><summary>Raw API response</summary><pre class="raw">${ctx.esc(JSON.stringify(raw, null, 2) || 'demo')}</pre></details>`;
    } catch (err) {
      out.innerHTML = `<p class="empty">Could not read that wallet (${ctx.esc(err.message)}). Check the address, or try again in a moment.</p>`;
    }
  }

  SR.App.register('vault', {
    mount(root, c) {
      ctx = c; el = root;
      root.innerHTML = `<div class="wrap">
        <section class="card">
          <h3>Holder check <span class="tag">non-custodial · read-only</span></h3>
          <p>Paste any wallet address to see its Squeeks, their power and merge readiness, and the best merges to make next.</p>
          <form class="row" data-v="form"><input class="input" data-v="addr" placeholder="0x…" autocomplete="off" spellcheck="false" style="flex:1;min-width:240px" value="${c.esc(c.profile.vaultAddress || '')}"><button class="btn primary" type="submit">Check wallet</button></form>
          <div class="grid4" style="margin-top:6px">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].slice(0, 4).map(L => `<div class="stat"><span class="k">Level ${L} power</span><span class="v">${power(L).toLocaleString('en-US')}</span></div>`).join('')}</div>
          <p class="small muted">Power per level from the Squeekchain docs: 1,000 × 2.2^(level − 1), up to level 10 (${power(10).toLocaleString('en-US')}).</p>
        </section>
        <div data-v="out" style="display:grid;gap:16px"></div>
      </div>`;
      root.querySelector('[data-v="form"]').addEventListener('submit', e => { e.preventDefault(); lookup(root.querySelector('[data-v="addr"]').value.trim()); });
      if (c.profile.vaultAddress) lookup(c.profile.vaultAddress);
    },
    unmount() { el = null; },
  });
})();
