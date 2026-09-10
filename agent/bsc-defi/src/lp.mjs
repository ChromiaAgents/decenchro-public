// PCS v3 liquidity lifecycle:
//   lp add       mint via NonfungiblePositionManager (creates+initializes the
//                pool when absent, price from --price or the v2 mid)
//   lp remove    decreaseLiquidity(full) → collect → burn
//   lp rebalance remove + re-mint centered on the current tick
// All dry-run by default; see tx.mjs for the write-chain rules.

import { parseUnits, formatUnits, getAddress } from 'viem';
import { chainId, maxSlippageBps } from './env.mjs';
import { chainConfig } from './chains.mjs';
import { publicClient, requireAccount, runWriteChain, approvalStepIfNeeded } from './tx.mjs';
import { resolvePair, tradeAddress } from './tokens.mjs';
import { v2MidPrice } from './swap.mjs';
import {
  feeToSpacing, parseRange, priceToTick, tickToPrice, alignTick,
  sqrtPriceX96FromFraction, rawPriceFromSqrtX96, minOutAfterSlippage,
} from './math.mjs';
import { erc20Abi } from './abi/erc20.mjs';
import { wbnbAbi } from './abi/wbnb.mjs';
import { npmAbi, v3FactoryAbi, v3PoolAbi, MAX_UINT128 } from './abi/v3.mjs';
import { CliError, requireAmount, requireFlag, deadline } from './util.mjs';

const ZERO = '0x0000000000000000000000000000000000000000';

function sortTokens(a, b, cfg) {
  const aAddr = tradeAddress(a, cfg);
  const bAddr = tradeAddress(b, cfg);
  const aFirst = BigInt(aAddr) < BigInt(bAddr);
  return {
    token0: aFirst ? { ...a, trade: aAddr } : { ...b, trade: bAddr },
    token1: aFirst ? { ...b, trade: bAddr } : { ...a, trade: aAddr },
    aIsToken0: aFirst,
  };
}

async function getPool(client, cfg, token0, token1, fee) {
  const pool = await client.readContract({
    address: cfg.pcs.v3Factory, abi: v3FactoryAbi, functionName: 'getPool',
    args: [token0, token1, fee],
  });
  return pool === ZERO ? null : pool;
}

export async function cmdLpAdd(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const account = requireAccount();
  const execute = flags.execute === true;
  const slippageBps = maxSlippageBps();

  const usage = 'lp add --pair WBNB/USDT --fee 2500 --range -5%..+5% --amount0 0.1 --amount1 60';
  const { a, b } = await resolvePair(client, cfg, requireFlag(flags, 'pair', usage));
  const fee = Number(flags.fee ?? 2500);
  const spacing = feeToSpacing(fee);
  const amountA = parseUnits(requireAmount(flags, 'amount0', usage), a.decimals);
  const amountB = parseUnits(requireAmount(flags, 'amount1', usage), b.decimals);

  const { token0, token1, aIsToken0 } = sortTokens(a, b, cfg);
  const [amount0Desired, amount1Desired] = aIsToken0 ? [amountA, amountB] : [amountB, amountA];

  const pool = await getPool(client, cfg, token0.trade, token1.trade, fee);
  let rawPrice; // token1 base units per token0 base unit
  let sqrtInit = null;
  let initPriceSource = null;
  if (pool) {
    const slot0 = await client.readContract({ address: pool, abi: v3PoolAbi, functionName: 'slot0' });
    rawPrice = rawPriceFromSqrtX96(slot0[0]);
  } else {
    // Pool must be created: price from --price (units of B per A) or the v2 mid.
    let humanBperA;
    if (flags.price && flags.price !== true) {
      humanBperA = String(flags.price);
      if (!(Number(humanBperA) > 0)) throw new CliError(`--price must be a positive number, got "${flags.price}"`);
      initPriceSource = '--price';
    } else {
      humanBperA = (await v2MidPrice(client, cfg, a, b)).price.toFixed(18);
      initPriceSource = 'v2 mid-price';
    }
    const p18 = parseUnits(Number(humanBperA).toFixed(18), 18);
    // raw(token1 per token0) as an exact fraction, then sqrt to X96.
    const num = aIsToken0 ? p18 * 10n ** BigInt(token1.decimals) : 10n ** 18n * 10n ** BigInt(token1.decimals);
    const den = aIsToken0 ? 10n ** 18n * 10n ** BigInt(token0.decimals) : p18 * 10n ** BigInt(token0.decimals);
    sqrtInit = sqrtPriceX96FromFraction(num, den);
    rawPrice = Number(num) / Number(den);
  }

  const range = parseRange(String(flags.range ?? '-5%..+5%'));
  let tickLower;
  let tickUpper;
  if (range.kind === 'pct') {
    tickLower = alignTick(priceToTick(rawPrice * (1 + range.lo)), spacing, 'down');
    tickUpper = alignTick(priceToTick(rawPrice * (1 + range.hi)), spacing, 'up');
  } else {
    tickLower = alignTick(range.lo, spacing, 'down');
    tickUpper = alignTick(range.hi, spacing, 'up');
  }
  if (tickLower >= tickUpper) {
    throw new CliError(`range collapsed after tick-spacing alignment (${tickLower}..${tickUpper}) — widen --range`);
  }

  const steps = [];
  const wrapWei = (a.native ? amountA : 0n) + (b.native ? amountB : 0n);
  if (wrapWei > 0n) {
    steps.push({
      label: `wrap ${formatUnits(wrapWei, 18)} BNB → WBNB`,
      address: getAddress(cfg.wbnb), abi: wbnbAbi, functionName: 'deposit', args: [], value: wrapWei,
    });
  }
  if (!pool) {
    steps.push({
      label: `create + initialize ${fee / 10000}% pool (price from ${initPriceSource})`,
      address: cfg.pcs.v3PositionManager, abi: npmAbi,
      functionName: 'createAndInitializePoolIfNecessary',
      args: [token0.trade, token1.trade, fee, sqrtInit],
    });
  }
  for (const [tok, amt] of [[token0, amount0Desired], [token1, amount1Desired]]) {
    if (amt === 0n) continue;
    const approval = await approvalStepIfNeeded({
      client, token: tok.trade, owner: account.address, spender: cfg.pcs.v3PositionManager,
      amount: amt, erc20Abi,
      label: `approve ${formatUnits(amt, tok.decimals)} ${tok.native ? 'WBNB' : tok.symbol} for position manager`,
    });
    if (approval) steps.push(approval);
  }
  const mintNeeds = steps.map((_s, i) => i); // funds + pool + allowances must land first
  steps.push({
    label: `mint ${token0.symbol}/${token1.symbol} ${fee / 10000}% position, ticks ${tickLower}..${tickUpper}`,
    address: cfg.pcs.v3PositionManager, abi: npmAbi, functionName: 'mint',
    args: [{
      token0: token0.trade, token1: token1.trade, fee,
      tickLower, tickUpper,
      amount0Desired, amount1Desired,
      // Mins stay 0: the pool decides the 0/1 split inside the range, so a
      // slippage floor on BOTH desired amounts would revert almost every
      // one-sided or off-ratio mint. Spend is still capped by the desired
      // amounts themselves.
      amount0Min: 0n, amount1Min: 0n,
      recipient: account.address, deadline: deadline(),
    }],
    needs: mintNeeds,
    wantResult: true,
    spendWei: token0.trade.toLowerCase() === cfg.wbnb.toLowerCase() && !token0.native ? amount0Desired
      : token1.trade.toLowerCase() === cfg.wbnb.toLowerCase() && !token1.native ? amount1Desired
      : 0n,
  });

  return runWriteChain({
    command: 'lp add',
    detail: {
      pair: `${a.symbol}/${b.symbol}`,
      fee,
      pool: pool ?? 'to be created',
      price: {
        [`${token1.symbol} per ${token0.symbol}`]:
          rawPrice * 10 ** (token0.decimals - token1.decimals),
        ...(initPriceSource ? { source: initPriceSource } : {}),
      },
      range: {
        tickLower, tickUpper,
        priceLower: tickToPrice(tickLower) * 10 ** (token0.decimals - token1.decimals),
        priceUpper: tickToPrice(tickUpper) * 10 ** (token0.decimals - token1.decimals),
      },
      amounts: {
        [token0.symbol]: formatUnits(amount0Desired, token0.decimals),
        [token1.symbol]: formatUnits(amount1Desired, token1.decimals),
      },
    },
    steps,
    execute,
  });
}

async function readPosition(client, cfg, tokenId) {
  const p = await client.readContract({
    address: cfg.pcs.v3PositionManager, abi: npmAbi, functionName: 'positions', args: [tokenId],
  }).catch(() => {
    throw new CliError(`position #${tokenId} does not exist on the position manager`);
  });
  const [t0meta, t1meta] = await client.multicall({
    contracts: [
      { address: p[2], abi: erc20Abi, functionName: 'symbol' },
      { address: p[3], abi: erc20Abi, functionName: 'symbol' },
    ],
    allowFailure: true,
  });
  const [d0, d1] = await client.multicall({
    contracts: [
      { address: p[2], abi: erc20Abi, functionName: 'decimals' },
      { address: p[3], abi: erc20Abi, functionName: 'decimals' },
    ],
    allowFailure: false,
  });
  return {
    token0: p[2], token1: p[3], fee: Number(p[4]),
    tickLower: Number(p[5]), tickUpper: Number(p[6]), liquidity: p[7],
    tokensOwed0: p[10], tokensOwed1: p[11],
    sym0: t0meta.status === 'success' ? t0meta.result : p[2],
    sym1: t1meta.status === 'success' ? t1meta.result : p[3],
    dec0: Number(d0), dec1: Number(d1),
  };
}

/** decrease(full)+collect(+burn) steps shared by remove and rebalance. */
async function teardownSteps({ client, cfg, account, tokenId, pos, slippageBps, burn }) {
  const steps = [];
  let expected = { amount0: 0n, amount1: 0n };
  if (pos.liquidity > 0n) {
    const sim = await client.simulateContract({
      address: cfg.pcs.v3PositionManager, abi: npmAbi, functionName: 'decreaseLiquidity',
      args: [{ tokenId, liquidity: pos.liquidity, amount0Min: 0n, amount1Min: 0n, deadline: deadline() }],
      account: account.address,
    }).catch((e) => {
      throw new CliError(`cannot remove #${tokenId}: ${e.shortMessage || e.message} (are you the owner?)`);
    });
    expected = { amount0: sim.result[0], amount1: sim.result[1] };
    steps.push({
      label: `decrease full liquidity of #${tokenId} (expect ~${formatUnits(expected.amount0, pos.dec0)} ${pos.sym0} + ~${formatUnits(expected.amount1, pos.dec1)} ${pos.sym1})`,
      address: cfg.pcs.v3PositionManager, abi: npmAbi, functionName: 'decreaseLiquidity',
      args: [{
        tokenId, liquidity: pos.liquidity,
        amount0Min: minOutAfterSlippage(expected.amount0, slippageBps),
        amount1Min: minOutAfterSlippage(expected.amount1, slippageBps),
        deadline: deadline(),
      }],
      wantResult: true,
    });
  }
  const collectIdx = steps.length;
  steps.push({
    label: `collect principal + fees of #${tokenId}`,
    address: cfg.pcs.v3PositionManager, abi: npmAbi, functionName: 'collect',
    args: [{ tokenId, recipient: account.address, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
    needs: pos.liquidity > 0n ? [0] : [],
    wantResult: true,
  });
  if (burn) {
    steps.push({
      label: `burn NFT #${tokenId}`,
      address: cfg.pcs.v3PositionManager, abi: npmAbi, functionName: 'burn', args: [tokenId],
      needs: pos.liquidity > 0n ? [0, collectIdx] : [collectIdx],
    });
  }
  return { steps, expected };
}

export async function cmdLpRemove(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const account = requireAccount();
  const execute = flags.execute === true;
  const tokenId = BigInt(requireFlag(flags, 'id', 'lp remove --id <tokenId>'));
  const pos = await readPosition(client, cfg, tokenId);

  const { steps, expected } = await teardownSteps({
    client, cfg, account, tokenId, pos, slippageBps: maxSlippageBps(), burn: true,
  });

  return runWriteChain({
    command: 'lp remove',
    detail: {
      tokenId,
      pair: `${pos.sym0}/${pos.sym1}`,
      fee: pos.fee,
      range: { tickLower: pos.tickLower, tickUpper: pos.tickUpper },
      expectedPrincipal: {
        [pos.sym0]: formatUnits(expected.amount0, pos.dec0),
        [pos.sym1]: formatUnits(expected.amount1, pos.dec1),
      },
      pendingFees: {
        [pos.sym0]: formatUnits(pos.tokensOwed0, pos.dec0),
        [pos.sym1]: formatUnits(pos.tokensOwed1, pos.dec1),
      },
    },
    steps,
    execute,
  });
}

export async function cmdLpRebalance(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const account = requireAccount();
  const execute = flags.execute === true;
  const slippageBps = maxSlippageBps();
  const tokenId = BigInt(requireFlag(flags, 'id', 'lp rebalance --id <tokenId> [--width 10%]'));

  const widthRaw = String(flags.width ?? '10%');
  const width = Number(widthRaw.replace(/%$/, '')) / 100;
  if (!(width > 0) || width >= 2) throw new CliError(`--width must be a percent like 10%, got "${widthRaw}"`);

  const pos = await readPosition(client, cfg, tokenId);
  const spacing = feeToSpacing(pos.fee);
  const pool = await getPool(client, cfg, pos.token0, pos.token1, pos.fee);
  if (!pool) throw new CliError(`pool for #${tokenId} not found via factory`);
  const slot0 = await client.readContract({ address: pool, abi: v3PoolAbi, functionName: 'slot0' });
  const currentTick = Number(slot0[1]);
  const rawPrice = rawPriceFromSqrtX96(slot0[0]);

  const newLower = alignTick(priceToTick(rawPrice * (1 - width / 2)), spacing, 'down');
  const newUpper = alignTick(priceToTick(rawPrice * (1 + width / 2)), spacing, 'up');
  const inRange = currentTick >= pos.tickLower && currentTick < pos.tickUpper;

  if (newLower === pos.tickLower && newUpper === pos.tickUpper) {
    return {
      command: 'lp rebalance', chainId: cfg.id, mode: execute ? 'executed' : 'dry-run',
      action: 'none', tokenId,
      note: `position already spans ${newLower}..${newUpper} centered on tick ${currentTick}`,
    };
  }

  const { steps, expected } = await teardownSteps({
    client, cfg, account, tokenId, pos, slippageBps, burn: true,
  });
  const teardownCount = steps.length;

  // Re-mint what the teardown frees (principal + owed fees).
  const desired0 = expected.amount0 + pos.tokensOwed0;
  const desired1 = expected.amount1 + pos.tokensOwed1;
  if (desired0 === 0n && desired1 === 0n) {
    throw new CliError(`#${tokenId} holds no liquidity and no fees — nothing to rebalance`);
  }
  for (const [tok, sym, dec, amt] of [
    [pos.token0, pos.sym0, pos.dec0, desired0],
    [pos.token1, pos.sym1, pos.dec1, desired1],
  ]) {
    if (amt === 0n) continue;
    const approval = await approvalStepIfNeeded({
      client, token: tok, owner: account.address, spender: cfg.pcs.v3PositionManager,
      amount: amt, erc20Abi,
      label: `approve ${formatUnits(amt, dec)} ${sym} for position manager`,
    });
    if (approval) steps.push(approval);
  }
  steps.push({
    label: `re-mint ${pos.sym0}/${pos.sym1} centered on tick ${currentTick}, ticks ${newLower}..${newUpper}`,
    address: cfg.pcs.v3PositionManager, abi: npmAbi, functionName: 'mint',
    args: [{
      token0: pos.token0, token1: pos.token1, fee: pos.fee,
      tickLower: newLower, tickUpper: newUpper,
      amount0Desired: desired0, amount1Desired: desired1,
      amount0Min: 0n, amount1Min: 0n, // see lp add — the pool picks the split
      recipient: account.address, deadline: deadline(),
    }],
    needs: steps.map((_s, i) => i),
    wantResult: true,
    spendWei: pos.token0.toLowerCase() === cfg.wbnb.toLowerCase() ? desired0
      : pos.token1.toLowerCase() === cfg.wbnb.toLowerCase() ? desired1
      : 0n,
  });

  return runWriteChain({
    command: 'lp rebalance',
    detail: {
      tokenId,
      pair: `${pos.sym0}/${pos.sym1}`,
      fee: pos.fee,
      currentTick,
      wasInRange: inRange,
      oldRange: { tickLower: pos.tickLower, tickUpper: pos.tickUpper },
      newRange: { tickLower: newLower, tickUpper: newUpper, width: widthRaw },
      redeploying: {
        [pos.sym0]: formatUnits(desired0, pos.dec0),
        [pos.sym1]: formatUnits(desired1, pos.dec1),
      },
      feesCollected: {
        [pos.sym0]: formatUnits(pos.tokensOwed0, pos.dec0),
        [pos.sym1]: formatUnits(pos.tokensOwed1, pos.dec1),
      },
      teardownSteps: teardownCount,
    },
    steps,
    execute,
  });
}
