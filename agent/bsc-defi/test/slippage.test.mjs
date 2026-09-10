import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minOutAfterSlippage } from '../src/math.mjs';

test('100 bps takes 1%', () => {
  assert.equal(minOutAfterSlippage(10_000n, 100), 9_900n);
});

test('0 bps is identity', () => {
  assert.equal(minOutAfterSlippage(123_456_789n, 0), 123_456_789n);
});

test('floor division (never rounds the floor up)', () => {
  assert.equal(minOutAfterSlippage(999n, 100), 989n); // 999*9900/10000 = 989.01 → 989
  assert.equal(minOutAfterSlippage(1n, 100), 0n);
});

test('big amounts stay exact (BigInt path)', () => {
  const amount = 10n ** 30n;
  assert.equal(minOutAfterSlippage(amount, 250), (amount * 9750n) / 10000n);
});
