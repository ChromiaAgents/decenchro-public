// Grid trading on PCS v2.
//   grid init    writes the state file (levels, size) — no chain writes
//   grid run     reads the v2 mid price, swaps once per level crossed since
//                the last run; idempotent via the state file
//   grid status  state + current price, read-only
//
// State lives under BSC_STATE_DIR (the agent volume), one file per pair.
// Crossing a level upward sells the base token, downward buys it back.

import fs from 'node:fs';
import path from 'node:path';
import { parseUnits, formatUnits, getAddress } from 'viem';
import { chainId, maxSlippageBps, stateDir } from './env.mjs';
import { chainConfig } from './chains.mjs';
import { publicClient, requireAccount, runWriteChain, approvalStepIfNeeded } from './tx.mjs';
import { resolvePair, tradeAddress } from './tokens.mjs';
import { v2MidPrice, v2Path } from './swap.mjs';
import { gridLevels, crossedLevels, minOutAfterSlippage } from './math.mjs';
import { erc20Abi } from './abi/erc20.mjs';
import { v2RouterAbi } from './abi/v2.mjs';
import { CliError, requireAmount, requireFlag, deadline } from './util.mjs';

const sanitize = (s) => String(s).replace(/[^A-Za-z0-9]/g, '');

function gridFile(symA, symB) {
  return path.join(stateDir(), `grid-${sanitize(symA)}-${sanitize(symB)}.json`);
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function loadState(flags) {
  const dir = stateDir();
  if (flags.pair && flags.pair !== true) {
    const [sa, sb] = String(flags.pair).split('/');
    const file = gridFile(sa ?? '', sb ?? '');
    if (!fs.existsSync(file)) throw new CliError(`no grid for ${flags.pair} — run grid init first (looked at ${file})`);
    return { file, state: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('grid-') && f.endsWith('.json')) : [];
  if (files.length === 0) throw new CliError(`no grid state in ${dir} — run grid init first`);
  if (files.length > 1) throw new CliError(`multiple grids exist (${files.join(', ')}) — pass --pair A/B`);
  const file = path.join(dir, files[0]);
  return { file, state: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

export async function cmdGridInit(flags) {
  const usage = 'grid init --pair WBNB/USDT --lower 500 --upper 700 --levels 11 --size 0.01';
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const { a, b } = await resolvePair(client, cfg, requireFlag(flags, 'pair', usage));
  const lower = Number(requireAmount(flags, 'lower', usage));
  const upper = Number(requireAmount(flags, 'upper', usage));
  const levelCount = Number(requireFlag(flags, 'levels', usage));
  const size = requireAmount(flags, 'size', usage);
  const levels = gridLevels(lower, upper, levelCount);
  const { price } = await v2MidPrice(client, cfg, a, b);

  const file = gridFile(a.symbol, b.symbol);
  if (fs.existsSync(file) && flags.force !== true) {
    throw new CliError(`grid for ${a.symbol}/${b.symbol} already exists at ${file} — pass --force to overwrite`);
  }

  const state = {
    version: 1,
    chainId: cfg.id,
    pair: {
      a: { symbol: a.symbol, address: a.address, decimals: a.decimals, native: a.native },
      b: { symbol: b.symbol, address: b.address, decimals: b.decimals, native: b.native },
    },
    lower, upper, levels,
    sizeA: size, // base-token amount traded per level, human units
    createdAt: new Date().toISOString(),
    lastPrice: null, // baseline is set on the first `grid run`
    fills: [],
  };
  saveState(file, state);

  return {
    command: 'grid init',
    chainId: cfg.id,
    stateFile: file,
    pair: `${a.symbol}/${b.symbol}`,
    levels,
    sizePerLevel: `${size} ${a.symbol}`,
    currentPrice: price,
    note: 'no chain writes — the first `grid run` sets the price baseline, later runs trade crossings',
  };
}

export async function cmdGridStatus(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const { file, state } = loadState(flags);
  const { price } = await v2MidPrice(client, cfg, state.pair.a, state.pair.b);
  const pending = state.lastPrice === null ? [] : crossedLevels(state.lastPrice, price, state.levels);
  return {
    command: 'grid status',
    chainId: cfg.id,
    stateFile: file,
    pair: `${state.pair.a.symbol}/${state.pair.b.symbol}`,
    lower: state.lower,
    upper: state.upper,
    levels: state.levels.length,
    sizePerLevel: `${state.sizeA} ${state.pair.a.symbol}`,
    lastPrice: state.lastPrice,
    currentPrice: price,
    pendingCrossings: pending,
    fillCount: state.fills.length,
    recentFills: state.fills.slice(-10),
  };
}

export async function cmdGridRun(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const account = requireAccount(); // mutating command
  const execute = flags.execute === true;
  const slippageBps = maxSlippageBps();

  const { file, state } = loadState(flags);
  const { a, b } = state.pair;
  const { price } = await v2MidPrice(client, cfg, a, b);

  if (state.lastPrice === null) {
    state.lastPrice = price;
    saveState(file, state);
    return {
      command: 'grid run', chainId: cfg.id, mode: execute ? 'executed' : 'dry-run',
      action: 'baseline-set', price,
      note: 'first run records the baseline price — crossings trade from the next run on',
    };
  }

  const crossings = crossedLevels(state.lastPrice, price, state.levels);
  if (crossings.length === 0) {
    return {
      command: 'grid run', chainId: cfg.id, mode: execute ? 'executed' : 'dry-run',
      action: 'none', price, lastPrice: state.lastPrice,
      note: 'no levels crossed since last run',
    };
  }

  const aAddr = tradeAddress(a, cfg);
  const bAddr = tradeAddress(b, cfg);
  const wbnb = getAddress(cfg.wbnb);
  const sizeA = parseUnits(state.sizeA, a.decimals);

  // One approval per token, sized for the whole run.
  const totalSellA = crossings.filter((c) => c.side === 'sell').reduce((s) => s + sizeA, 0n);
  let totalSpendB = 0n;
  for (const c of crossings.filter((x) => x.side === 'buy')) {
    totalSpendB += parseUnits((Number(state.sizeA) * c.price).toFixed(b.decimals), b.decimals);
  }

  const steps = [];
  const approvalIdx = [];
  if (totalSellA > 0n && !a.native) {
    const approval = await approvalStepIfNeeded({
      client, token: aAddr, owner: account.address, spender: cfg.pcs.v2Router,
      amount: totalSellA, erc20Abi,
      label: `approve ${formatUnits(totalSellA, a.decimals)} ${a.symbol} for v2 router`,
    });
    if (approval) { approvalIdx.push(steps.length); steps.push(approval); }
  }
  if (totalSpendB > 0n && !b.native) {
    const approval = await approvalStepIfNeeded({
      client, token: bAddr, owner: account.address, spender: cfg.pcs.v2Router,
      amount: totalSpendB, erc20Abi,
      label: `approve ${formatUnits(totalSpendB, b.decimals)} ${b.symbol} for v2 router`,
    });
    if (approval) { approvalIdx.push(steps.length); steps.push(approval); }
  }

  const pathAB = await v2Path(client, cfg, aAddr, bAddr);
  const pathBA = [...pathAB].reverse();
  const to = account.address;

  for (const crossing of crossings) {
    const levelPrice = crossing.price;
    const recordFill = (extra) => ({ hash }) => {
      state.fills.push({
        level: levelPrice, side: crossing.side, txHash: hash,
        price, at: new Date().toISOString(), ...extra,
      });
      state.lastPrice = levelPrice; // progressive: a crash resumes after this level
      saveState(file, state);
    };
    if (crossing.side === 'sell') {
      // price rose through the level: sell sizeA of A for B at ≥ level*(1-slip)
      const minOutB = minOutAfterSlippage(
        parseUnits((Number(state.sizeA) * levelPrice).toFixed(b.decimals), b.decimals),
        slippageBps,
      );
      steps.push({
        label: `grid sell ${state.sizeA} ${a.symbol} @ level ${levelPrice} (min ${formatUnits(minOutB, b.decimals)} ${b.symbol})`,
        address: cfg.pcs.v2Router, abi: v2RouterAbi,
        functionName: a.native ? 'swapExactETHForTokens' : b.native ? 'swapExactTokensForETH' : 'swapExactTokensForTokens',
        args: a.native
          ? [minOutB, pathAB, to, deadline()]
          : [sizeA, minOutB, pathAB, to, deadline()],
        ...(a.native ? { value: sizeA } : {}),
        spendWei: !a.native && aAddr === wbnb ? sizeA : 0n,
        needs: [...approvalIdx],
        afterReceipt: recordFill({ amountIn: `${state.sizeA} ${a.symbol}` }),
      });
    } else {
      // price fell through the level: spend sizeA*level of B to buy A back
      const spendB = parseUnits((Number(state.sizeA) * levelPrice).toFixed(b.decimals), b.decimals);
      const minOutA = minOutAfterSlippage(sizeA, slippageBps);
      steps.push({
        label: `grid buy ${state.sizeA} ${a.symbol} @ level ${levelPrice} (spend ${formatUnits(spendB, b.decimals)} ${b.symbol})`,
        address: cfg.pcs.v2Router, abi: v2RouterAbi,
        functionName: b.native ? 'swapExactETHForTokens' : a.native ? 'swapExactTokensForETH' : 'swapExactTokensForTokens',
        args: b.native
          ? [minOutA, pathBA, to, deadline()]
          : [spendB, minOutA, pathBA, to, deadline()],
        ...(b.native ? { value: spendB } : {}),
        spendWei: !b.native && bAddr === wbnb ? spendB : 0n,
        needs: [...approvalIdx],
        afterReceipt: recordFill({ amountIn: `${formatUnits(spendB, b.decimals)} ${b.symbol}` }),
      });
    }
  }

  const result = await runWriteChain({
    command: 'grid run',
    detail: {
      pair: `${a.symbol}/${b.symbol}`,
      lastPrice: state.lastPrice,
      price,
      crossings,
      sizePerLevel: `${state.sizeA} ${a.symbol}`,
    },
    steps,
    execute,
  });

  if (execute) {
    state.lastPrice = price; // all crossings landed — advance to the live price
    saveState(file, state);
    result.fillsRecorded = crossings.length;
    result.stateFile = file;
  }
  return result;
}
