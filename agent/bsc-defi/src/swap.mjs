// `bsc-defi swap --in <SYM> --out <SYM> --amount <n> [--execute]`
// PancakeSwap v2 exact-in swap with the slippage cap from env. Native BNB
// legs auto-wrap/unwrap (WBNB deposit/withdraw or the ETH router variants).
// Approvals happen inside the same invocation's write chain when needed.

import { parseUnits, formatUnits, getAddress, zeroAddress } from 'viem';
import { chainId, maxSlippageBps } from './env.mjs';
import { chainConfig } from './chains.mjs';
import { publicClient, requireAccount, runWriteChain, approvalStepIfNeeded } from './tx.mjs';
import { resolveToken, tokenList, tradeAddress } from './tokens.mjs';
import { minOutAfterSlippage } from './math.mjs';
import { erc20Abi } from './abi/erc20.mjs';
import { wbnbAbi } from './abi/wbnb.mjs';
import { v2RouterAbi, v2FactoryAbi, v2PairAbi } from './abi/v2.mjs';
import { CliError, requireAmount, requireFlag, deadline } from './util.mjs';

async function getPair(client, cfg, a, b) {
  const pair = await client.readContract({
    address: cfg.pcs.v2Factory,
    abi: v2FactoryAbi,
    functionName: 'getPair',
    args: [a, b],
  });
  return pair === zeroAddress ? null : pair;
}

/** Direct pair if it exists, else hop through WBNB, else a clear error. */
export async function v2Path(client, cfg, inAddr, outAddr) {
  if (await getPair(client, cfg, inAddr, outAddr)) return [inAddr, outAddr];
  const wbnb = getAddress(cfg.wbnb);
  if (inAddr !== wbnb && outAddr !== wbnb) {
    const [legA, legB] = await Promise.all([
      getPair(client, cfg, inAddr, wbnb),
      getPair(client, cfg, wbnb, outAddr),
    ]);
    if (legA && legB) return [inAddr, wbnb, outAddr];
  }
  throw new CliError(`no PancakeSwap v2 route between ${inAddr} and ${outAddr} on chain ${cfg.id}`);
}

/** Mid price from v2 pair reserves: human units of B per unit of A. */
export async function v2MidPrice(client, cfg, tokenA, tokenB) {
  const aAddr = tradeAddress(tokenA, cfg);
  const bAddr = tradeAddress(tokenB, cfg);
  const pair = await getPair(client, cfg, aAddr, bAddr);
  if (!pair) {
    throw new CliError(`no v2 pair for ${tokenA.symbol}/${tokenB.symbol} on chain ${cfg.id} — cannot read a price`);
  }
  const [reserves, token0] = await Promise.all([
    client.readContract({ address: pair, abi: v2PairAbi, functionName: 'getReserves' }),
    client.readContract({ address: pair, abi: v2PairAbi, functionName: 'token0' }),
  ]);
  const aIs0 = token0.toLowerCase() === aAddr.toLowerCase();
  const [reserveA, reserveB] = aIs0 ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]];
  if (reserveA === 0n || reserveB === 0n) throw new CliError(`v2 pair ${pair} has empty reserves`);
  const a = Number(formatUnits(reserveA, tokenA.decimals));
  const b = Number(formatUnits(reserveB, tokenB.decimals));
  return { price: b / a, pair, reserveA, reserveB };
}

export async function cmdSwap(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const account = requireAccount(); // mutating command: key required even for dry-run
  const execute = flags.execute === true;
  const slippageBps = maxSlippageBps();

  const tokens = await tokenList(client, cfg);
  const tokenIn = await resolveToken(client, cfg, requireFlag(flags, 'in', 'swap --in BNB --out USDT --amount 0.1'), tokens);
  const tokenOut = await resolveToken(client, cfg, requireFlag(flags, 'out'), tokens);
  const amountIn = parseUnits(requireAmount(flags, 'amount'), tokenIn.decimals);

  const inAddr = tradeAddress(tokenIn, cfg);
  const outAddr = tradeAddress(tokenOut, cfg);
  const wbnb = getAddress(cfg.wbnb);
  const detailBase = {
    tokenIn: { symbol: tokenIn.symbol, amount: formatUnits(amountIn, tokenIn.decimals) },
    tokenOut: { symbol: tokenOut.symbol },
    slippageBps,
  };

  // Pure wrap / unwrap — no router, no slippage.
  if (tokenIn.native && !tokenOut.native && outAddr === wbnb) {
    return runWriteChain({
      command: 'swap',
      detail: { ...detailBase, kind: 'wrap' },
      steps: [{
        label: `wrap ${formatUnits(amountIn, 18)} BNB → WBNB`,
        address: wbnb, abi: wbnbAbi, functionName: 'deposit', args: [], value: amountIn,
      }],
      execute,
    });
  }
  if (tokenOut.native && !tokenIn.native && inAddr === wbnb) {
    return runWriteChain({
      command: 'swap',
      detail: { ...detailBase, kind: 'unwrap' },
      steps: [{
        label: `unwrap ${formatUnits(amountIn, 18)} WBNB → BNB`,
        address: wbnb, abi: wbnbAbi, functionName: 'withdraw', args: [amountIn],
        spendWei: amountIn,
      }],
      execute,
    });
  }
  if (inAddr === outAddr) throw new CliError(`--in and --out resolve to the same token (${tokenIn.symbol})`);

  const path = await v2Path(client, cfg, inAddr, outAddr);
  const amounts = await client.readContract({
    address: cfg.pcs.v2Router,
    abi: v2RouterAbi,
    functionName: 'getAmountsOut',
    args: [amountIn, path],
  });
  const quotedOut = amounts[amounts.length - 1];
  const minOut = minOutAfterSlippage(quotedOut, slippageBps);

  const steps = [];
  let swapNeeds = [];
  if (!tokenIn.native) {
    const approval = await approvalStepIfNeeded({
      client, token: inAddr, owner: account.address, spender: cfg.pcs.v2Router,
      amount: amountIn, erc20Abi,
      label: `approve ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol} for v2 router`,
    });
    if (approval) {
      steps.push(approval);
      swapNeeds = [0];
    }
  }

  const to = account.address;
  if (tokenIn.native) {
    steps.push({
      label: `swap ${formatUnits(amountIn, 18)} BNB → ${tokenOut.symbol} (min ${formatUnits(minOut, tokenOut.decimals)})`,
      address: cfg.pcs.v2Router, abi: v2RouterAbi, functionName: 'swapExactETHForTokens',
      args: [minOut, path, to, deadline()], value: amountIn, needs: swapNeeds,
    });
  } else if (tokenOut.native) {
    steps.push({
      label: `swap ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol} → BNB (min ${formatUnits(minOut, 18)})`,
      address: cfg.pcs.v2Router, abi: v2RouterAbi, functionName: 'swapExactTokensForETH',
      args: [amountIn, minOut, path, to, deadline()], needs: swapNeeds,
      spendWei: inAddr === wbnb ? amountIn : 0n,
    });
  } else {
    steps.push({
      label: `swap ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol} → ${tokenOut.symbol} (min ${formatUnits(minOut, tokenOut.decimals)})`,
      address: cfg.pcs.v2Router, abi: v2RouterAbi, functionName: 'swapExactTokensForTokens',
      args: [amountIn, minOut, path, to, deadline()], needs: swapNeeds,
      spendWei: inAddr === wbnb ? amountIn : 0n,
    });
  }

  return runWriteChain({
    command: 'swap',
    detail: {
      ...detailBase,
      path,
      quote: {
        amountOut: formatUnits(quotedOut, tokenOut.decimals),
        minOut: formatUnits(minOut, tokenOut.decimals),
      },
    },
    steps,
    execute,
  });
}
