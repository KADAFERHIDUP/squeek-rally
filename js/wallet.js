/* Squeek Orbit: non-custodial wallet helper (EIP-1193 / EIP-6963).
 *
 * Squeek Orbit never sees a private key or seed phrase. It only:
 *   1. asks the player's own wallet for their address,
 *   2. encodes contract calls (ABI) for contracts whose addresses come from Squeekchain's /economy/state,
 *   3. simulates every call with eth_call before anything can be sent,
 *   4. hands the unsigned transaction to the wallet, where the player reviews and signs it themselves.
 *
 * Function selectors are keccak-256 of the signatures below (precomputed and checked in the test suite).
 */
'use strict';
window.SR = window.SR || {};

(() => {
  const SR = window.SR;
  const SEPOLIA = 11155111;
  const SEPOLIA_HEX = '0xaa36a7';
  const EXPLORER = 'https://sepolia.etherscan.io';

  const FN = {
    'merge(uint256,uint256)':                   'd1c2babb',
    'mergeDeposited(address,uint256,uint256)':  '9a96734e',
    'safeTransferFrom(address,address,uint256)': '42842e0e',
    'setApprovalForAll(address,bool)':          'a22cb465',
    'deposit(address,uint256[])':               'a71604e8',
    'claimAndStake()':                          'cb1a4fc0',
    'isApprovedForAll(address,address)':        'e985e9c5',
    'ownerOf(uint256)':                         '6352211e',
    'balanceOf(address)':                       '70a08231',
  };

  // ---------------------------------------------------------------- ABI encoding (static types + one uint256[] tail)
  const isAddr = a => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
  const word = hex => hex.padStart(64, '0');
  const encUint = v => { const b = BigInt(v); if (b < 0n || b >= 1n << 256n) throw new Error('uint256 out of range'); return word(b.toString(16)); };
  const encAddr = a => { if (!isAddr(a)) throw new Error(`not an address: ${a}`); return word(a.slice(2).toLowerCase()); };
  const encBool = b => word(b ? '1' : '0');

  /** Encode a call. args are [type, value] pairs; supports address, uint256, bool and uint256[]. */
  function encode(sig, args) {
    const sel = FN[sig];
    if (!sel) throw new Error(`unknown function ${sig}`);
    const head = [], tail = [];
    const headSize = args.length * 32;
    for (const [type, v] of args) {
      if (type === 'address') head.push(encAddr(v));
      else if (type === 'uint256') head.push(encUint(v));
      else if (type === 'bool') head.push(encBool(v));
      else if (type === 'uint256[]') {
        head.push(encUint(headSize + tail.join('').length / 2));
        tail.push(encUint(v.length), ...v.map(encUint));
      } else throw new Error(`unsupported type ${type}`);
    }
    return '0x' + sel + head.join('') + tail.join('');
  }
  const decAddr = hex => '0x' + String(hex).slice(-40);
  const decBool = hex => BigInt(hex || '0x0') !== 0n;

  /** Pull a readable reason out of a wallet / node error (Error(string), Panic(uint256) or a custom error). */
  function reason(err) {
    const seen = new Set();
    let data = null, msg = '';
    const walk = (e, depth) => {
      if (!e || typeof e !== 'object' || seen.has(e) || depth > 5) return;
      seen.add(e);
      if (!msg && typeof e.message === 'string') msg = e.message;
      if (!data && typeof e.data === 'string' && /^0x[0-9a-fA-F]*$/.test(e.data)) data = e.data;
      walk(e.data, depth + 1); walk(e.error, depth + 1); walk(e.cause, depth + 1); walk(e.info, depth + 1);
    };
    walk(err, 0);
    if (err && err.code === 4001) return 'You rejected the request in your wallet.';
    if (data && data.startsWith('0x08c379a0') && data.length >= 138) {
      try {
        const len = Number(BigInt('0x' + data.slice(74, 138)));
        const bytes = data.slice(138, 138 + len * 2).match(/../g) || [];
        return 'Reverted: ' + new TextDecoder().decode(new Uint8Array(bytes.map(b => parseInt(b, 16))));
      } catch { /* fall through */ }
    }
    if (data && data.startsWith('0x4e487b71')) return `Reverted with panic code 0x${BigInt('0x' + data.slice(10)).toString(16)}`;
    if (data && data.length >= 10) return `Reverted with contract error ${data.slice(0, 10)}`;
    return msg ? msg.replace(/^.*?execution reverted:?\s*/i, 'Reverted: ') : 'The call failed.';
  }

  // ---------------------------------------------------------------- provider discovery (EIP-6963, then window.ethereum)
  const wallets = new Map();
  window.addEventListener('eip6963:announceProvider', e => {
    const d = e.detail;
    if (d && d.info && d.provider && d.info.uuid) { wallets.set(d.info.uuid, d); changed(); }
  });
  try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch { /* old browser */ }

  const st = { provider: null, name: null, account: null, chainId: null };
  const subs = [];
  const changed = () => subs.forEach(f => { try { f(st); } catch (e) { console.error(e); } });

  function available() {
    const list = [...wallets.values()].map(w => ({ id: w.info.uuid, name: w.info.name, icon: w.info.icon, provider: w.provider }));
    if (!list.length && window.ethereum) list.push({ id: 'injected', name: window.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet', icon: null, provider: window.ethereum });
    return list;
  }

  function bind(p) {
    if (!p || !p.on || p.__squeekBound) return;
    p.__squeekBound = true;
    p.on('accountsChanged', a => { if (st.provider === p) { st.account = a && a[0] ? a[0] : null; changed(); } });
    p.on('chainChanged', c => { if (st.provider === p) { st.chainId = Number.parseInt(c, 16); changed(); } });
  }

  async function connect(id) {
    const list = available();
    const w = list.find(x => x.id === id) || list[0];
    if (!w) throw new Error('No wallet found in this browser. Install MetaMask, Rabby or another EVM wallet.');
    const accounts = await w.provider.request({ method: 'eth_requestAccounts' });
    st.provider = w.provider; st.name = w.name;
    st.account = accounts && accounts[0] ? accounts[0] : null;
    st.chainId = Number.parseInt(await w.provider.request({ method: 'eth_chainId' }), 16);
    bind(w.provider);
    changed();
    return st;
  }
  function disconnect() { st.provider = null; st.name = null; st.account = null; st.chainId = null; changed(); }

  async function switchToSepolia() {
    if (!st.provider) throw new Error('Connect a wallet first.');
    try { await st.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_HEX }] }); }
    catch (e) {
      if (e && e.code === 4902) {
        await st.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: SEPOLIA_HEX, chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.sepolia.org'], blockExplorerUrls: [EXPLORER] }] });
      } else throw e;
    }
    st.chainId = Number.parseInt(await st.provider.request({ method: 'eth_chainId' }), 16);
    changed();
  }

  /** Every action goes through here: re-reads the chain id, so a network switch in the wallet is never missed. */
  async function guard() {
    if (!st.provider || !st.account) throw new Error('Connect a wallet first.');
    st.chainId = Number.parseInt(await st.provider.request({ method: 'eth_chainId' }), 16);
    if (st.chainId !== SEPOLIA) throw new Error(`Your wallet is on chain ${st.chainId}. Switch to Sepolia (11155111) first.`);
  }
  async function call(to, data, from = st.account) {
    if (!st.provider) throw new Error('Connect a wallet first.');
    return st.provider.request({ method: 'eth_call', params: [{ from, to, data }, 'latest'] });
  }
  /** Simulate a transaction from the connected account. Resolves with a gas estimate or rejects with a reason. */
  async function simulate(to, data) {
    await guard();
    try {
      await call(to, data);
      const gas = await st.provider.request({ method: 'eth_estimateGas', params: [{ from: st.account, to, data }] });
      return { ok: true, gas: Number(BigInt(gas)) };
    } catch (e) { return { ok: false, reason: reason(e) }; }
  }
  async function send(to, data) {
    await guard();
    return st.provider.request({ method: 'eth_sendTransaction', params: [{ from: st.account, to, data }] });
  }
  async function waitReceipt(hash, { timeoutMs = 180000, everyMs = 3000 } = {}) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const r = await st.provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null);
      if (r) return { ok: r.status === '0x1' || r.status === 1, block: Number(BigInt(r.blockNumber || 0)), receipt: r };
      await new Promise(res => setTimeout(res, everyMs));
    }
    return { ok: null, pending: true };
  }

  const reads = {
    ownerOf: async (nft, id) => decAddr(await call(nft, encode('ownerOf(uint256)', [['uint256', id]]))),
    isApprovedForAll: async (nft, owner, op) => decBool(await call(nft, encode('isApprovedForAll(address,address)', [['address', owner], ['address', op]]))),
  };

  /** The calls Vaultar can prepare. Each returns { to, data, sig, args, label } and is never sent without a passing simulation. */
  const build = {
    merge: (c, keep, burn) => ({ to: c.collection, sig: 'merge(uint256,uint256)', args: [['uint256', keep], ['uint256', burn]], label: `Merge Squeek #${burn} into #${keep}` }),
    mergeDeposited: (c, keep, burn) => ({ to: c.staking, sig: 'mergeDeposited(address,uint256,uint256)', args: [['address', c.collection], ['uint256', keep], ['uint256', burn]], label: `Merge staked Squeek #${burn} into #${keep}` }),
    depositOne: (c, from, id) => ({ to: c.collection, sig: 'safeTransferFrom(address,address,uint256)', args: [['address', from], ['address', c.staking], ['uint256', id]], label: `Deposit Squeek #${id} into staking` }),
    approveStaking: c => ({ to: c.collection, sig: 'setApprovalForAll(address,bool)', args: [['address', c.staking], ['bool', true]], label: 'Allow the staking contract to move your Squeeks' }),
    deposit: (c, ids) => ({ to: c.staking, sig: 'deposit(address,uint256[])', args: [['address', c.collection], ['uint256[]', ids]], label: `Deposit ${ids.length} Squeek${ids.length > 1 ? 's' : ''} into staking` }),
    claimAndStake: c => ({ to: c.staking, sig: 'claimAndStake()', args: [], label: 'Claim staking rewards and stake them' }),
  };
  for (const k of Object.keys(build)) {
    const f = build[k];
    build[k] = (...a) => { const tx = f(...a); if (!isAddr(tx.to)) throw new Error('Contract address not available from /economy/state yet.'); tx.data = encode(tx.sig, tx.args); return tx; };
  }

  SR.Wallet = {
    SEPOLIA, EXPLORER, FN, state: st, onChange: fn => subs.push(fn),
    available, connect, disconnect, switchToSepolia, simulate, send, waitReceipt, reads, build, encode, reason, isAddr,
    short: a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '',
    same: (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase(),
  };
})();
