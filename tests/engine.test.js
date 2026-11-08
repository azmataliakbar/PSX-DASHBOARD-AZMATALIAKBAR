'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');

const CFG = {
  commission: 0.0015, salesTaxOnCommission: 0.15, baseSlippage: 0.0005, impact: 0.1,
  cgt: { filer: 0.15, nonFiler: 0.30 }
};
const quote = (price, halted) => ({ price, halted: !!halted });

function ins(extra) {
  return Object.assign({ t: 'AAA', n: 'A', s: 'Textile', g: 'Extended', p: 100, sh: 10, vol: 0.02, beta: 1 }, extra || {});
}

test('the same seed gives the same market path', () => {
  const instruments = [ins({ t: 'AAA' }), ins({ t: 'BBB', s: 'Auto' })];
  const make = () => E.createMarket({ instruments, ticksPerSession: 360, seed: 42, marketDaily: 0.008, sectorDaily: 0.006, breakerLimit: 0.1 });
  const a = make(), b = make();
  for (let i = 0; i < 360; i++) { a.step(); b.step(); }
  assert.deepEqual(a.quotes(), b.quotes());
});

test('a saved market restores to exactly the same state', () => {
  const instruments = [ins()];
  const m1 = E.createMarket({ instruments, ticksPerSession: 360, seed: 7, marketDaily: 0.008, sectorDaily: 0.006, breakerLimit: 0.1 });
  for (let i = 0; i < 100; i++) m1.step();
  const saved = JSON.parse(JSON.stringify(m1.state()));
  const m2 = E.createMarket({ instruments, ticksPerSession: 360, seed: 1, marketDaily: 0.008, sectorDaily: 0.006, breakerLimit: 0.1 });
  m2.restore(saved);
  for (let i = 0; i < 100; i++) { m1.step(); m2.step(); }
  assert.deepEqual(m1.quotes(), m2.quotes());
});

test('the circuit breaker freezes a stock exactly at the limit', () => {
  // A very high beta makes a large move in one tick.
  const instruments = [ins({ beta: 200, vol: 0.001 })];
  const m = E.createMarket({ instruments, ticksPerSession: 360, seed: 3, marketDaily: 0.05, sectorDaily: 0.0, breakerLimit: 0.1 });
  let halted = null;
  for (let i = 0; i < 360 && !halted; i++) {
    m.step();
    const q = m.quote('AAA');
    if (q.halted) halted = q;
  }
  assert.ok(halted, 'expected a halt');
  assert.ok(Math.abs(Math.abs(halted.pct) - 10) < 1e-9, 'pct should be exactly 10% from the previous close: ' + halted.pct);
  const frozenAt = halted.price;
  for (let i = 0; i < 20; i++) m.step();
  assert.equal(m.quote('AAA').price, frozenAt, 'price stays frozen for the rest of the session');
});

test('next session clears halts and uses today\'s close as the new reference', () => {
  const instruments = [ins({ beta: 200, vol: 0.001 })];
  const m = E.createMarket({ instruments, ticksPerSession: 360, seed: 3, marketDaily: 0.05, sectorDaily: 0.0, breakerLimit: 0.1 });
  while (m.step()) { /* run the day */ }
  const close = m.quote('AAA').price;
  m.nextSession();
  const q = m.quote('AAA');
  assert.equal(q.halted, false);
  assert.equal(q.prev, close);
});

test('the wallet charges commission and sales tax on a buy', () => {
  const w = E.createWallet({ cfg: CFG, startCash: 1000000, filer: true, maxLog: 10 });
  const r = w.buy('AAA', 100, quote(100), 0.0);
  // Slippage at this size is just the base 0.05%.
  const price = 100 * (1 + 0.0005);
  const value = 100 * price;
  const comm = value * 0.0015;
  const stax = comm * 0.15;
  assert.ok(Math.abs(r.total - (value + comm + stax)) < 1e-6, 'total = value + commission + sales tax');
  assert.ok(Math.abs(w.value({ AAA: quote(100) }).cash - (1000000 - r.total)) < 1e-6);
});

test('a halted stock cannot be bought or sold', () => {
  const w = E.createWallet({ cfg: CFG, startCash: 1000000, filer: true, maxLog: 10 });
  assert.throws(() => w.buy('AAA', 10, quote(100, true), 0.02), /Trading halted/);
  w.buy('AAA', 10, quote(100), 0.02);
  assert.throws(() => w.sell('AAA', 5, quote(100, true), 0.02), /Trading halted/);
});

test('buys need whole shares and enough cash', () => {
  const w = E.createWallet({ cfg: CFG, startCash: 1000, filer: true, maxLog: 10 });
  assert.throws(() => w.buy('AAA', 1.5, quote(100), 0.02), /whole number/);
  assert.throws(() => w.buy('AAA', 0, quote(100), 0.02), /whole number/);
  assert.throws(() => w.buy('AAA', 100, quote(100), 0.02), /Not enough cash/);
});

test('capital gains tax applies only to a profit, at the filer or non-filer rate', () => {
  const filer = E.createWallet({ cfg: CFG, startCash: 1000000, filer: true, maxLog: 10 });
  filer.buy('AAA', 100, quote(100), 0.01);
  const sellUp = filer.sell('AAA', 100, quote(120), 0.01);
  assert.ok(sellUp.tax > 0);
  assert.ok(Math.abs(sellUp.tax - sellUp.realised * 0.15) < 1e-6, 'filer tax = 15% of the gain');

  const nonFiler = E.createWallet({ cfg: CFG, startCash: 1000000, filer: false, maxLog: 10 });
  nonFiler.buy('AAA', 100, quote(100), 0.01);
  const sellUp2 = nonFiler.sell('AAA', 100, quote(120), 0.01);
  assert.ok(Math.abs(sellUp2.tax - sellUp2.realised * 0.30) < 1e-6, 'non-filer tax = 30% of the gain');

  const loss = E.createWallet({ cfg: CFG, startCash: 1000000, filer: true, maxLog: 10 });
  loss.buy('AAA', 100, quote(100), 0.01);
  const sellDown = loss.sell('AAA', 100, quote(80), 0.01);
  assert.equal(sellDown.tax, 0, 'no tax on a loss');
});

test('average cost is kept across two buys and a partial sell', () => {
  const w = E.createWallet({ cfg: CFG, startCash: 10000000, filer: true, maxLog: 10 });
  w.buy('AAA', 100, quote(100), 0.0);
  w.buy('AAA', 100, quote(200), 0.0);
  const h = w.value({ AAA: quote(200) }).holdings[0];
  assert.equal(h.qty, 200);
  w.sell('AAA', 100, quote(200), 0.0);
  const h2 = w.value({ AAA: quote(200) }).holdings[0];
  assert.equal(h2.qty, 100);
  assert.ok(Math.abs(h2.avg - h.avg) < 1e-6, 'average cost unchanged by a sale');
});

test('slippage rises with volatility and order size', () => {
  const small = E.createWallet({ cfg: CFG, startCash: 1e12, filer: true, maxLog: 10 });
  const big = E.createWallet({ cfg: CFG, startCash: 1e12, filer: true, maxLog: 10 });
  const s = small.buy('AAA', 10, quote(100), 0.02);
  const b = big.buy('AAA', 100000, quote(100), 0.02);
  assert.ok(s.price / 100 - 1 < b.price / 100 - 1, 'bigger orders pay more slippage per share');
});

test('risk: index weights sum to one, and an over-weight stock is flagged', () => {
  const instruments = [ins({ t: 'AAA', sh: 1000, s: 'Textile' }), ins({ t: 'BBB', sh: 1, s: 'Auto' })];
  const quotes = { AAA: { price: 1000, halted: false }, BBB: { price: 1, halted: false } };
  const r = E.assess({
    instruments, quotes, returnsByTicker: {}, ticksPerSession: 360,
    wallet: null, conc: { stockMax: 0.1, sectorMax: 0.25, walletStockMax: 0.2, walletSectorMax: 0.35, corrMax: 0.6 }
  });
  const sum = Object.values(r.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(r.flags.some((f) => /AAA is/.test(f.text)), 'AAA should be flagged as over-weight');
});

test('risk: a frozen stock is flagged as a danger', () => {
  const instruments = [ins({ t: 'AAA' }), ins({ t: 'BBB', s: 'Auto' })];
  const quotes = { AAA: { price: 110, halted: true }, BBB: { price: 100, halted: false } };
  const r = E.assess({
    instruments, quotes, returnsByTicker: {}, ticksPerSession: 360, wallet: null,
    conc: { stockMax: 0.9, sectorMax: 0.9, walletStockMax: 0.2, walletSectorMax: 0.35, corrMax: 0.6 }
  });
  assert.ok(r.flags.some((f) => f.level === 'danger' && /circuit breaker/.test(f.text)));
});

test('volatility and correlation behave as expected', () => {
  assert.equal(E.volatility([0.01, 0.01], 360), null, 'too few points gives no value');
  assert.equal(E.correlation([1, 2, 3, 4, 5, 6], [2, 4, 6, 8, 10, 12]).toFixed(6), '1.000000');
  assert.equal(E.correlation([1, 2, 3, 4, 5, 6], [-2, -4, -6, -8, -10, -12]).toFixed(6), '-1.000000');
});

test('the random source is roughly standard normal', () => {
  const rng = E.makeRng(99);
  const xs = [];
  for (let i = 0; i < 40000; i++) xs.push(E.normal(rng));
  assert.ok(Math.abs(E.mean(xs)) < 0.02, 'mean near 0');
  assert.ok(Math.abs(E.stdev(xs) - 1) < 0.02, 'stdev near 1');
});
