// Checks the precomputed function selectors (keccak-256) and the ABI encoding Vaultar sends to wallets.
const { sel } = require('./keccak.js');
global.window = { addEventListener(){}, dispatchEvent(){}, SR: {} };
global.Event = class {};
require('../js/wallet.js');
const W = window.SR.Wallet;
let bad = 0;
for (const [sig, s] of Object.entries(W.FN)) { const k = sel(sig); if (k !== s) { bad++; console.log('MISMATCH', sig, s, k); } }
const A = '0x50fd1780526c3186a0c037c7622203bc4fb611ca', C = '0xc4c7982657f00509548f3a3a41db7fa439a6856b';
const pad = h => h.padStart(64, '0');
const exp1 = '0xd1c2babb' + pad('7') + pad('1f');
if (W.encode('merge(uint256,uint256)', [['uint256', 7], ['uint256', 31]]) !== exp1) { bad++; console.log('merge enc'); }
const exp2 = '0xa71604e8' + pad(C.slice(2)) + pad('40') + pad('3') + pad('1') + pad('2') + pad('270f');
if (W.encode('deposit(address,uint256[])', [['address', C], ['uint256[]', [1, 2, 9999]]]) !== exp2) { bad++; console.log('deposit enc'); }
if (W.encode('claimAndStake()', []) !== '0xcb1a4fc0') { bad++; }
const tx = W.build.approveStaking({ collection: C, staking: A });
if (tx.to !== C || tx.data !== '0xa22cb465' + pad(A.slice(2)) + pad('1')) { bad++; console.log('approve'); }
try { W.build.merge({ collection: null }, 1, 2); bad++; } catch (e) { }
// revert decoding
const msg = Buffer.from('MergesClosed').toString('hex');
const data = '0x08c379a0' + pad('20') + pad('c') + msg.padEnd(64, '0');
const r = W.reason({ code: -32603, message: 'Internal', data: { data } });
if (r !== 'Reverted: MergesClosed') { bad++; console.log('reason', r); }
if (W.reason({ code: 4001 }) !== 'You rejected the request in your wallet.') bad++;
console.log(bad ? `FAIL ${bad}` : 'ABI TESTS PASSED');
