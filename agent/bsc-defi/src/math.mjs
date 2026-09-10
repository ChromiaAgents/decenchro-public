// Pure math — no network, fully covered by test/. Everything price-shaped
// here is a "raw" pool price (token1 base units per token0 base unit) unless
// the name says human. humanToRaw converts between the two.

import { CliError } from './util.mjs';

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/** PancakeSwap v3 fee tier (bps of a bp, i.e. 2500 = 0.25%) → tick spacing. */
export const TICK_SPACING = { 100: 1, 500: 10, 2500: 50, 10000: 200 };

export function feeToSpacing(fee) {
  const spacing = TICK_SPACING[fee];
  if (!spacing) {
    throw new CliError(`unsupported fee tier ${fee} — one of ${Object.keys(TICK_SPACING).join(', ')}`);
  }
  return spacing;
}

/** Raw price → nearest tick at or below it: floor(log_1.0001(price)). */
export function priceToTick(rawPrice) {
  if (!(rawPrice > 0)) throw new CliError(`price must be > 0, got ${rawPrice}`);
  return Math.floor(Math.log(rawPrice) / Math.log(1.0001));
}

export function tickToPrice(tick) {
  return 1.0001 ** tick;
}

/** Human price (quote per base) → raw pool price (token1 per token0, base units). */
export function humanToRaw(humanPrice, decimals0, decimals1) {
  return humanPrice * 10 ** (decimals1 - decimals0);
}

/** Snap a tick to the fee tier's grid. dir: 'down' | 'up' | 'nearest'. */
export function alignTick(tick, spacing, dir = 'nearest') {
  let aligned;
  if (dir === 'down') aligned = Math.floor(tick / spacing) * spacing;
  else if (dir === 'up') aligned = Math.ceil(tick / spacing) * spacing;
  else aligned = Math.round(tick / spacing) * spacing;
  const min = Math.ceil(MIN_TICK / spacing) * spacing;
  const max = Math.floor(MAX_TICK / spacing) * spacing;
  return Math.min(Math.max(aligned, min), max);
}

/**
 * Parse `--range`. Two forms:
 *   "-5%..+5%"   → { kind: 'pct', lo: -0.05, hi: 0.05 }  (relative to current price)
 *   "-1200..3450" → { kind: 'ticks', lo: -1200, hi: 3450 } (absolute ticks)
 */
export function parseRange(spec) {
  const m = String(spec).split('..');
  if (m.length !== 2) throw new CliError(`--range must be "<lo>..<hi>", got "${spec}"`);
  const [loRaw, hiRaw] = m.map((s) => s.trim());
  const isPct = loRaw.endsWith('%') || hiRaw.endsWith('%');
  if (isPct) {
    const pct = (s) => {
      const n = Number(s.replace(/%$/, '').replace(/^\+/, ''));
      if (!Number.isFinite(n)) throw new CliError(`bad percent in --range: "${s}"`);
      return n / 100;
    };
    const lo = pct(loRaw);
    const hi = pct(hiRaw);
    if (lo >= hi) throw new CliError(`--range lower must be below upper (${spec})`);
    if (lo <= -1) throw new CliError('--range lower bound must be above -100%');
    return { kind: 'pct', lo, hi };
  }
  const lo = Number(loRaw);
  const hi = Number(hiRaw);
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
    throw new CliError(`--range ticks must be integers, got "${spec}"`);
  }
  if (lo >= hi) throw new CliError(`--range lower tick must be below upper (${spec})`);
  return { kind: 'ticks', lo, hi };
}

/** Exact-in slippage floor: amount * (10000 - bps) / 10000, floor division. */
export function minOutAfterSlippage(amount, bps) {
  return (amount * BigInt(10000 - bps)) / 10000n;
}

/** Integer sqrt (Newton) for BigInt. */
export function isqrt(n) {
  if (n < 0n) throw new CliError('isqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * sqrtPriceX96 for pool initialization, from a raw price expressed as the
 * fraction amount1Raw/amount0Raw (BigInt-exact — no float on the X96 path).
 */
export function sqrtPriceX96FromFraction(amount1Raw, amount0Raw) {
  if (amount0Raw <= 0n || amount1Raw <= 0n) {
    throw new CliError('pool init price needs positive amounts on both sides');
  }
  return isqrt((amount1Raw << 192n) / amount0Raw);
}

/** sqrtPriceX96 → raw price (float; plenty for tick math and display). */
export function rawPriceFromSqrtX96(sqrtPriceX96) {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  return ratio * ratio;
}

/**
 * Venus health factor. markets: [{ supplyUsd, borrowUsd, collateralFactor, entered }].
 * Collateral counts only for entered markets (comptroller.getAssetsIn).
 * hf === null means no borrows (infinite HF).
 */
export function healthFactor(markets) {
  let weightedCollateralUsd = 0;
  let borrowUsd = 0;
  for (const m of markets) {
    if (m.entered) weightedCollateralUsd += (m.supplyUsd ?? 0) * (m.collateralFactor ?? 0);
    borrowUsd += m.borrowUsd ?? 0;
  }
  const hf = borrowUsd > 0 ? weightedCollateralUsd / borrowUsd : null;
  return { hf, weightedCollateralUsd, borrowUsd };
}

/** USD of borrow to repay so that weighted/borrow ≥ minHf. ≥ 0. */
export function repayUsdToReachHf(weightedCollateralUsd, borrowUsd, minHf) {
  if (!(minHf > 0)) throw new CliError(`--min-hf must be > 0, got ${minHf}`);
  return Math.max(0, borrowUsd - weightedCollateralUsd / minHf);
}

/** HF after repaying repayUsd of borrows (null once fully repaid). */
export function hfAfterRepay(weightedCollateralUsd, borrowUsd, repayUsd) {
  const remaining = borrowUsd - repayUsd;
  return remaining > 0 ? weightedCollateralUsd / remaining : null;
}

/**
 * Venus supply/borrow APY from ratePerBlock mantissa (1e18), compounded
 * daily per the Venus docs: dailyRate = rate/1e18 * blocksPerDay,
 * APY% = ((1 + dailyRate)^365 - 1) * 100. BSC 3s blocks → 10_512_000/yr.
 */
export function venusApyPercent(ratePerBlockMantissa, blocksPerYear = 10_512_000) {
  const blocksPerDay = blocksPerYear / 365;
  const daily = (Number(ratePerBlockMantissa) / 1e18) * blocksPerDay;
  return ((1 + daily) ** 365 - 1) * 100;
}

/** Grid levels: n evenly spaced prices, bounds inclusive. */
export function gridLevels(lower, upper, n) {
  if (!(lower > 0) || !(upper > lower)) {
    throw new CliError(`grid needs 0 < lower < upper, got ${lower}..${upper}`);
  }
  if (!Number.isInteger(n) || n < 2 || n > 200) {
    throw new CliError(`--levels must be an integer 2-200, got ${n}`);
  }
  const step = (upper - lower) / (n - 1);
  return Array.from({ length: n }, (_v, i) => lower + i * step);
}

/**
 * Levels crossed moving prev → curr. Rising through a level sells the base
 * (take profit above), falling through buys it. Returned in crossing order.
 * A level equal to prev does not re-trigger (idempotent across runs).
 */
export function crossedLevels(prev, curr, levels) {
  if (curr > prev) {
    return levels
      .filter((l) => l > prev && l <= curr)
      .sort((a, b) => a - b)
      .map((price) => ({ price, side: 'sell' }));
  }
  if (curr < prev) {
    return levels
      .filter((l) => l < prev && l >= curr)
      .sort((a, b) => b - a)
      .map((price) => ({ price, side: 'buy' }));
  }
  return [];
}
