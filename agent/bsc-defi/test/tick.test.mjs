import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priceToTick, tickToPrice, alignTick, feeToSpacing, parseRange,
  humanToRaw, sqrtPriceX96FromFraction, rawPriceFromSqrtX96, isqrt,
  MIN_TICK, MAX_TICK,
} from '../src/math.mjs';

test('priceToTick: price 1 is tick 0', () => {
  assert.equal(priceToTick(1), 0);
});

test('priceToTick/tickToPrice round-trip within one tick', () => {
  for (const price of [0.0001, 0.5, 1, 42.7, 1e6]) {
    const tick = priceToTick(price);
    assert.ok(tickToPrice(tick) <= price * (1 + 1e-12), `floor property at ${price}`);
    assert.ok(tickToPrice(tick + 1) > price, `next tick exceeds ${price}`);
  }
});

test('priceToTick rejects non-positive prices', () => {
  assert.throws(() => priceToTick(0));
  assert.throws(() => priceToTick(-3));
});

test('fee tier → tick spacing (PCS v3: 2500 → 50)', () => {
  assert.equal(feeToSpacing(100), 1);
  assert.equal(feeToSpacing(500), 10);
  assert.equal(feeToSpacing(2500), 50);
  assert.equal(feeToSpacing(10000), 200);
  assert.throws(() => feeToSpacing(3000)); // Uniswap tier, not PCS
});

test('alignTick rounds to spacing in the asked direction', () => {
  assert.equal(alignTick(123, 50, 'down'), 100);
  assert.equal(alignTick(123, 50, 'up'), 150);
  assert.equal(alignTick(-123, 50, 'down'), -150);
  assert.equal(alignTick(-123, 50, 'up'), -100);
  assert.equal(alignTick(150, 50, 'down'), 150); // already aligned
  assert.equal(alignTick(124, 50, 'nearest'), 100);
  assert.equal(alignTick(126, 50, 'nearest'), 150);
});

test('alignTick clamps to the usable tick domain', () => {
  assert.ok(alignTick(MIN_TICK - 500, 50, 'down') >= MIN_TICK);
  assert.ok(alignTick(MAX_TICK + 500, 50, 'up') <= MAX_TICK);
  assert.equal(alignTick(MAX_TICK, 200, 'up') % 200, 0);
});

test('parseRange: percent form', () => {
  assert.deepEqual(parseRange('-5%..+5%'), { kind: 'pct', lo: -0.05, hi: 0.05 });
  assert.deepEqual(parseRange('-10%..20%'), { kind: 'pct', lo: -0.1, hi: 0.2 });
});

test('parseRange: tick form', () => {
  assert.deepEqual(parseRange('-1200..3450'), { kind: 'ticks', lo: -1200, hi: 3450 });
});

test('parseRange rejects nonsense', () => {
  assert.throws(() => parseRange('5%'));
  assert.throws(() => parseRange('+5%..-5%')); // inverted
  assert.throws(() => parseRange('1.5..2.5')); // non-integer ticks
  assert.throws(() => parseRange('-150%..+5%')); // below -100%
});

test('humanToRaw adjusts for decimal difference', () => {
  // 600 USDT(6dec) per WBNB(18dec): raw token1-per-token0 = 600 * 10^(6-18)
  assert.equal(humanToRaw(600, 18, 6), 600e-12);
  assert.equal(humanToRaw(600, 18, 18), 600);
});

test('isqrt exact squares and floors', () => {
  assert.equal(isqrt(0n), 0n);
  assert.equal(isqrt(1n), 1n);
  assert.equal(isqrt(144n), 12n);
  assert.equal(isqrt(145n), 12n);
  assert.equal(isqrt(10n ** 36n), 10n ** 18n);
});

test('sqrtPriceX96 for price 1 is exactly 2^96', () => {
  assert.equal(sqrtPriceX96FromFraction(1n, 1n), 2n ** 96n);
});

test('sqrtPriceX96 round-trips through rawPriceFromSqrtX96', () => {
  // 600 quote(18dec) per base(18dec)
  const sqrt = sqrtPriceX96FromFraction(600n * 10n ** 18n, 10n ** 18n);
  const raw = rawPriceFromSqrtX96(sqrt);
  assert.ok(Math.abs(raw - 600) / 600 < 1e-9, `expected ~600, got ${raw}`);
});
