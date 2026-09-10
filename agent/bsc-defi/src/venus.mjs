// Shared Venus reads: market metadata + a full account snapshot with USD
// values and health factor. Used by positions, yield and health.

import { formatUnits } from 'viem';
import { comptrollerAbi, vTokenAbi, venusOracleAbi } from './abi/venus.mjs';
import { erc20Abi } from './abi/erc20.mjs';
import { healthFactor } from './math.mjs';
import { venusMarkets } from './tokens.mjs';

/**
 * Market metadata for a chain:
 * [{ vToken, vSymbol, underlying|null, symbol, decimals, collateralFactor,
 *    supplyRatePerBlock, borrowRatePerBlock, listed }]
 */
export async function marketMeta(client, cfg) {
  const markets = await venusMarkets(client, cfg);
  const per = 5;
  const reads = await client.multicall({
    contracts: markets.flatMap((vToken) => [
      { address: vToken, abi: vTokenAbi, functionName: 'symbol' },
      { address: vToken, abi: vTokenAbi, functionName: 'underlying' },
      { address: vToken, abi: vTokenAbi, functionName: 'supplyRatePerBlock' },
      { address: vToken, abi: vTokenAbi, functionName: 'borrowRatePerBlock' },
      { address: cfg.venus.comptroller, abi: comptrollerAbi, functionName: 'markets', args: [vToken] },
    ]),
    allowFailure: true,
  });

  const meta = [];
  for (let i = 0; i < markets.length; i++) {
    const [sym, underlying, supplyRate, borrowRate, marketInfo] = reads.slice(i * per, (i + 1) * per);
    const native = underlying.status !== 'success'; // vBNB has no underlying()
    meta.push({
      vToken: markets[i],
      vSymbol: sym.status === 'success' ? sym.result : markets[i],
      underlying: native ? null : underlying.result,
      native,
      supplyRatePerBlock: supplyRate.status === 'success' ? supplyRate.result : null,
      borrowRatePerBlock: borrowRate.status === 'success' ? borrowRate.result : null,
      listed: marketInfo.status === 'success' ? marketInfo.result[0] : false,
      collateralFactor:
        marketInfo.status === 'success' ? Number(formatUnits(marketInfo.result[1], 18)) : 0,
    });
  }

  // Underlying symbol/decimals (native market = BNB/18).
  const erc20s = meta.filter((m) => !m.native);
  if (erc20s.length > 0) {
    const tokenReads = await client.multicall({
      contracts: erc20s.flatMap((m) => [
        { address: m.underlying, abi: erc20Abi, functionName: 'symbol' },
        { address: m.underlying, abi: erc20Abi, functionName: 'decimals' },
      ]),
      allowFailure: true,
    });
    erc20s.forEach((m, i) => {
      m.symbol = tokenReads[i * 2].status === 'success' ? tokenReads[i * 2].result : m.vSymbol;
      m.decimals = tokenReads[i * 2 + 1].status === 'success' ? Number(tokenReads[i * 2 + 1].result) : 18;
    });
  }
  for (const m of meta) {
    if (m.native) {
      m.symbol = 'BNB';
      m.decimals = 18;
    }
  }
  return meta;
}

/** raw underlying amount × oracle price (1e(36-dec)) → USD float. */
export function usdValue(rawAmount, priceMantissa) {
  return Number(formatUnits(rawAmount * priceMantissa, 36));
}

/**
 * Full account snapshot: per-market balances, USD values, membership,
 * account liquidity/shortfall and health factor.
 */
export async function accountSnapshot(client, cfg, owner) {
  const meta = await marketMeta(client, cfg);
  const [oracle, assetsIn, liquidity] = await Promise.all([
    client.readContract({ address: cfg.venus.comptroller, abi: comptrollerAbi, functionName: 'oracle' }),
    client.readContract({ address: cfg.venus.comptroller, abi: comptrollerAbi, functionName: 'getAssetsIn', args: [owner] }),
    client.readContract({ address: cfg.venus.comptroller, abi: comptrollerAbi, functionName: 'getAccountLiquidity', args: [owner] }),
  ]);
  const entered = new Set(assetsIn.map((a) => a.toLowerCase()));

  const per = 4;
  const reads = await client.multicall({
    contracts: meta.flatMap((m) => [
      { address: m.vToken, abi: vTokenAbi, functionName: 'balanceOf', args: [owner] },
      { address: m.vToken, abi: vTokenAbi, functionName: 'exchangeRateStored' },
      { address: m.vToken, abi: vTokenAbi, functionName: 'borrowBalanceStored', args: [owner] },
      { address: oracle, abi: venusOracleAbi, functionName: 'getUnderlyingPrice', args: [m.vToken] },
    ]),
    allowFailure: true,
  });

  const markets = [];
  for (let i = 0; i < meta.length; i++) {
    const m = meta[i];
    const [vBal, rate, borrow, price] = reads.slice(i * per, (i + 1) * per);
    if (vBal.status !== 'success' || rate.status !== 'success') continue;
    const vTokenBalance = vBal.result;
    const exchangeRate = rate.result;
    const borrowRaw = borrow.status === 'success' ? borrow.result : 0n;
    const priceMantissa = price.status === 'success' ? price.result : 0n;
    const supplyRaw = (vTokenBalance * exchangeRate) / 10n ** 18n;
    markets.push({
      ...m,
      vTokenBalance,
      exchangeRate,
      priceMantissa,
      supplyRaw,
      borrowRaw,
      supply: formatUnits(supplyRaw, m.decimals),
      borrow: formatUnits(borrowRaw, m.decimals),
      supplyUsd: usdValue(supplyRaw, priceMantissa),
      borrowUsd: usdValue(borrowRaw, priceMantissa),
      entered: entered.has(m.vToken.toLowerCase()),
    });
  }

  const hf = healthFactor(markets);
  return {
    owner,
    markets,
    liquidityUsd: Number(formatUnits(liquidity[1], 18)),
    shortfallUsd: Number(formatUnits(liquidity[2], 18)),
    ...hf,
  };
}
