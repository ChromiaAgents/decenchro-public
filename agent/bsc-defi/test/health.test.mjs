import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthFactor, repayUsdToReachHf, hfAfterRepay, venusApyPercent } from '../src/math.mjs';

const market = (supplyUsd, borrowUsd, collateralFactor, entered = true) =>
  ({ supplyUsd, borrowUsd, collateralFactor, entered });

test('healthFactor: single collateral, single borrow', () => {
  // $1000 supplied at 0.8 factor, $400 borrowed → HF = 800/400 = 2
  const { hf, weightedCollateralUsd, borrowUsd } = healthFactor([
    market(1000, 0, 0.8),
    market(0, 400, 0.6),
  ]);
  assert.equal(weightedCollateralUsd, 800);
  assert.equal(borrowUsd, 400);
  assert.equal(hf, 2);
});

test('healthFactor: collateral only counts when the market is entered', () => {
  const { hf } = healthFactor([
    market(1000, 0, 0.8, false), // supplied but not entered → no collateral
    market(0, 400, 0.6),
  ]);
  assert.equal(hf, 0);
});

test('healthFactor: no borrows → hf null (infinite)', () => {
  const { hf, borrowUsd } = healthFactor([market(1000, 0, 0.8)]);
  assert.equal(hf, null);
  assert.equal(borrowUsd, 0);
});

test('healthFactor: mixed portfolio', () => {
  // weighted = 500*0.8 + 300*0.6 = 580; borrows = 200+90 = 290 → HF 2.0
  const { hf } = healthFactor([
    market(500, 200, 0.8),
    market(300, 90, 0.6),
  ]);
  assert.ok(Math.abs(hf - 2.0) < 1e-12);
});

test('repayUsdToReachHf: exact algebra', () => {
  // weighted 120, borrows 100, min 1.5 → repay = 100 - 120/1.5 = 20
  assert.equal(repayUsdToReachHf(120, 100, 1.5), 20);
});

test('repayUsdToReachHf: already healthy → 0', () => {
  assert.equal(repayUsdToReachHf(300, 100, 1.5), 0);
});

test('hfAfterRepay recovers the target', () => {
  const repay = repayUsdToReachHf(120, 100, 1.5);
  assert.ok(Math.abs(hfAfterRepay(120, 100, repay) - 1.5) < 1e-12);
  assert.equal(hfAfterRepay(120, 100, 100), null); // fully repaid
});

test('venusApyPercent: zero rate → 0%', () => {
  assert.equal(venusApyPercent(0n), 0);
});

test('venusApyPercent matches the daily-compound formula', () => {
  // ratePerBlock 1e9 mantissa, 10512000 blocks/yr → daily = 1e-9 * 28800
  const daily = 1e-9 * 28800;
  const expected = ((1 + daily) ** 365 - 1) * 100;
  const got = venusApyPercent(1_000_000_000n, 10_512_000);
  assert.ok(Math.abs(got - expected) < 1e-12, `${got} vs ${expected}`);
  // sanity: ~1.056% APY for ~1.05% APR
  assert.ok(got > 1.05 && got < 1.06);
});
