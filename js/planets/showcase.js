/* Planet 6 · Squeekhaven (Apps for Squeek NFT holders)
 * Look up any Squeek (/v1/squeeks/{id}), give it a nickname and pin it to a showcase wall.
 * Squeeks owned by the wallet saved in Vaultar get a "verified holder" badge (read-only check).
 * On-chain SVG art is only ever shown through <img>, never injected into the page. */
'use strict';
(() => {
  const SR = window.SR;
  let el = null, ctx = null, currentSq = null;

  const artHtml = s => s && s.image ? `<img src="${ctx.esc(s.image)}" alt="${ctx.esc(s.name)} artwork">` : `<span class="mono muted small">no art</span>`;

  function holderBadge(s) {
    const addr = (ctx.profile.vaultAddress || '').toLowerCase();
    if (!addr) return '';
    const own = [s.owner, s.depositor].filter(Boolean).map(x => String(x).toLowerCase());
    return own.includes(addr) ? '<span class="pill ok">verified holder</span>' : '';
  }

  function renderCard() {
    const box = el.querySelector('[data-h="card"]');
    const s = currentSq;
    if (!s) { box.innerHTML = '<p class="empty">Enter a Squeek number to bring it to Squeekhaven.</p>'; return; }
    const nick = ctx.profile.names[s.id] || '';
    const pinned = ctx.profile.showcase.some(x => x.id === s.id);
    box.innerHTML = `
      <div class="cols" style="grid-template-columns:220px 1fr">
        <div class="sq"><div class="art">${artHtml(s)}</div></div>
        <div style="display:grid;gap:8px;align-content:start">
          <div class="row"><b style="font:400 20px var(--display);color:var(--pc)">${ctx.esc(nick || s.name)}</b>${holderBadge(s)}${s.burned ? '<span class="pill bad">burned</span>' : ''}</div>
          <div class="grid3">
            <div class="stat"><span class="k">Level</span><span class="v">${s.level ?? '–'}</span></div>
            <div class="stat"><span class="k">Power</span><span class="v">${s.power ? s.power.toLocaleString('en-US') : '–'}</span></div>
            <div class="stat"><span class="k">Merge</span><span class="v" style="font-size:15px">${ctx.esc(s.mergeState || '–')}</span></div>
          </div>
          <p class="small muted">Owner ${s.owner ? `<span class="mono">${ctx.esc(String(s.owner).slice(0, 8))}…${ctx.esc(String(s.owner).slice(-4))}</span>` : 'unknown'}${s.depositor ? ' · deposited in staking' : ''}</p>
          ${s.attributes.length ? `<div class="row">${s.attributes.slice(0, 8).map(a => `<span class="pill">${ctx.esc(a.trait_type ?? a.type ?? 'trait')}: ${ctx.esc(a.value)}</span>`).join('')}</div>` : ''}
          <form class="row" data-h="nameform"><input class="input" data-h="nick" maxlength="24" placeholder="Give it a name" value="${ctx.esc(nick)}" style="flex:1"><button class="btn" type="submit">Save name</button></form>
          <div class="row">
            <button type="button" class="btn primary" data-act="pin">${pinned ? '✓ On your wall' : '📌 Pin to showcase'}</button>
            <button type="button" class="btn" data-act="share">Copy share text</button>
          </div>
        </div>
      </div>`;
    box.querySelector('[data-h="nameform"]').addEventListener('submit', e => {
      e.preventDefault();
      const v = box.querySelector('[data-h="nick"]').value.trim();
      if (v) ctx.profile.names[s.id] = v; else delete ctx.profile.names[s.id];
      const pin = ctx.profile.showcase.find(x => x.id === s.id); if (pin) pin.nick = v;
      ctx.saveProfile(); ctx.toast(v ? `Squeek #${s.id} is now "${v}"` : 'Name cleared'); renderCard(); renderWall();
    });
  }

  function renderWall() {
    const w = el.querySelector('[data-h="wall"]');
    const list = ctx.profile.showcase;
    w.innerHTML = list.length ? list.map(x => `
      <div class="sq"><div class="art">${x.image ? `<img src="${ctx.esc(x.image)}" alt="">` : `<span style="font:400 28px var(--display);color:var(--pc)">#${x.id}</span>`}</div>
      <b>${ctx.esc(ctx.profile.names[x.id] || x.name)}</b><span class="small muted">L${x.level ?? '?'} · ${(x.power || 0).toLocaleString('en-US')} power</span>
      <div class="row"><button type="button" class="btn" data-open="${x.id}" style="padding:6px 10px">Open</button><button type="button" class="btn" data-unpin="${x.id}" style="padding:6px 10px">Remove</button></div></div>`).join('')
      : '<p class="muted small">Your wall is empty. Look up a Squeek and pin it.</p>';
  }

  async function open(id) {
    const box = el.querySelector('[data-h="card"]');
    if (!/^\d{1,5}$/.test(String(id))) { box.innerHTML = '<p class="empty">Squeek numbers are whole numbers (there are 9,999 Squeeks).</p>'; return; }
    box.innerHTML = '<p class="empty">Fetching Squeek…</p>';
    try {
      const { demo, squeek } = await SR.Data.fetchSqueek(Number(id));
      currentSq = squeek;
      renderCard();
      if (demo) box.insertAdjacentHTML('afterbegin', '<p class="note">Demo data: the Squeekchain API could not be reached from here.</p>');
    } catch (err) {
      currentSq = null;
      box.innerHTML = `<p class="empty">Squeek #${ctx.esc(id)} could not be loaded (${ctx.esc(err.message)}). It may not be minted yet.</p>`;
    }
  }

  SR.App.register('showcase', {
    mount(root, c) {
      ctx = c; el = root;
      root.innerHTML = `<div class="wrap">
        <section class="card">
          <h3>Find a Squeek <span class="tag">holders' haven</span></h3>
          <form class="row" data-h="find"><input class="input" data-h="id" inputmode="numeric" placeholder="Squeek number, e.g. 42" style="flex:1;max-width:260px"><button class="btn primary" type="submit">Look up</button></form>
          <div data-h="card"></div>
          <p class="small muted">Names and your showcase wall are saved on this device. Save your wallet in Vaultar to get a verified-holder badge on Squeeks you own.</p>
        </section>
        <section class="card"><h3>My showcase wall <span class="tag">${c.profile.showcase.length} pinned</span></h3><div class="sq-grid" data-h="wall"></div></section>
      </div>`;
      root.querySelector('[data-h="find"]').addEventListener('submit', e => { e.preventDefault(); open(root.querySelector('[data-h="id"]').value.trim()); });
      root.addEventListener('click', e => {
        const a = e.target.closest('[data-act]'), op = e.target.closest('[data-open]'), un = e.target.closest('[data-unpin]');
        if (op) { root.querySelector('[data-h="id"]').value = op.dataset.open; open(op.dataset.open); }
        if (un) { c.profile.showcase = c.profile.showcase.filter(x => String(x.id) !== un.dataset.unpin); c.saveProfile(); renderWall(); if (currentSq) renderCard(); }
        if (!a || !currentSq) return;
        const s = currentSq;
        if (a.dataset.act === 'pin') {
          if (!c.profile.showcase.some(x => x.id === s.id)) {
            c.profile.showcase.unshift({ id: s.id, name: s.name, level: s.level, power: s.power, image: s.image && s.image.length < 60000 ? s.image : null });
            c.profile.showcase = c.profile.showcase.slice(0, 24);
            c.saveProfile(); c.toast(`Squeek #${s.id} pinned to your wall`, 'win');
          }
          renderCard(); renderWall();
        }
        if (a.dataset.act === 'share') {
          const name = c.profile.names[s.id] || s.name;
          const text = `Meet ${name}: Squeek #${s.id}, level ${s.level ?? '?'} with ${s.power ? s.power.toLocaleString('en-US') : '?'} power on @squeekchain. Squeektoshi mines, my Squeek earns. 🐹`;
          navigator.clipboard.writeText(text).then(() => c.toast('Share text copied'), () => c.toast(text));
        }
      });
      currentSq = null; renderCard(); renderWall();
    },
    unmount() { el = null; },
  });
})();
