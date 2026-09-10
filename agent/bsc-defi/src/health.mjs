// Venus health factor:
//   health check                       HF, liquidity, shortfall, per-market detail
//   health protect --min-hf 1.5        when HF < min: plan/execute a repayBorrow
//                                      from the wallet's balance of the borrowed
//                                      asset to lift HF back over the floor
// HF = Σ(supplyUsd × collateralFactor, entered markets) / Σ(borrowUsd).

import { parseUnits, formatUnits } from 'viem';
import { chainId } from './env.mjs';
import { chainConfig } from './chains.mjs';
import { publicClient, requireAccount, ownerAddress, runWriteChain, approvalStepIfNeeded } from './tx.mjs';
import { accountSnapshot } from './venus.mjs';
import { repayUsdToReachHf, hfAfterRepay } from './math.mjs';
import { erc20Abi } from './abi/erc20.mjs';
import { vTokenAbi, vBnbAbi } from './abi/venus.mjs';
import { CliError } from './util.mjs';

function snapshotView(snap) {
  return {
    healthFactor: snap.hf,
    weightedCollateralUsd: snap.weightedCollateralUsd,
    borrowUsd: snap.borrowUsd,
    liquidityUsd: snap.liquidityUsd,
    shortfallUsd: snap.shortfallUsd,
    markets: snap.markets
      .filter((m) => m.supplyRaw > 0n || m.borrowRaw > 0n)
      .map((m) => ({
        vToken: m.vToken,
        vSymbol: m.vSymbol,
        symbol: m.symbol,
        supply: m.supply,
        supplyUsd: m.supplyUsd,
        borrow: m.borrow,
        borrowUsd: m.borrowUsd,
        collateralFactor: m.collateralFactor,
        entered: m.entered,
      })),
  };
}

export async function cmdHealthCheck(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const owner = ownerAddress(flags);
  const snap = await accountSnapshot(client, cfg, owner);
  return { command: 'health check', chainId: cfg.id, owner, ...snapshotView(snap) };
}

export async function cmdHealthProtect(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const account = requireAccount(); // mutating command
  const execute = flags.execute === true;

  const minHfRaw = flags['min-hf'] ?? '1.5';
  const minHf = Number(minHfRaw);
  if (!Number.isFinite(minHf) || minHf <= 1) {
    throw new CliError(`--min-hf must be a number above 1.0, got "${minHfRaw}"`);
  }

  const snap = await accountSnapshot(client, cfg, account.address);
  const base = { command: 'health protect', chainId: cfg.id, owner: account.address, minHf };

  if (snap.hf === null) {
    return { ...base, mode: execute ? 'executed' : 'dry-run', action: 'none', reason: 'no borrows — health factor is infinite' };
  }
  if (snap.hf >= minHf) {
    return { ...base, mode: execute ? 'executed' : 'dry-run', action: 'none', healthFactor: snap.hf, reason: `HF ${snap.hf.toFixed(4)} ≥ min ${minHf}` };
  }

  const repayUsd = repayUsdToReachHf(snap.weightedCollateralUsd, snap.borrowUsd, minHf);
  const debt = snap.markets
    .filter((m) => m.borrowRaw > 0n)
    .sort((a, b) => b.borrowUsd - a.borrowUsd)[0];
  if (!debt) {
    return { ...base, mode: execute ? 'executed' : 'dry-run', action: 'none', reason: 'no borrow market found despite HF < min (oracle glitch?) — no action taken' };
  }
  if (debt.priceMantissa === 0n) {
    throw new CliError(`oracle returned no price for ${debt.vSymbol} — refusing to compute a repay amount`);
  }

  // USD → raw units of the borrowed asset: raw = usd(1e18) * 1e18 / priceMantissa.
  const neededRaw0 = (parseUnits(repayUsd.toFixed(18), 18) * 10n ** 18n) / debt.priceMantissa;
  const neededRaw = neededRaw0 > debt.borrowRaw ? debt.borrowRaw : neededRaw0;

  const walletBal = debt.native
    ? await client.getBalance({ address: account.address })
    : await client.readContract({ address: debt.underlying, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
  const gasReserve = debt.native ? 5_000_000_000_000_000n : 0n; // keep 0.005 BNB for gas
  const available = walletBal > gasReserve ? walletBal - gasReserve : 0n;
  const repayRaw = neededRaw < available ? neededRaw : available;

  const detail = {
    healthFactor: snap.hf,
    weightedCollateralUsd: snap.weightedCollateralUsd,
    borrowUsd: snap.borrowUsd,
    market: { vToken: debt.vToken, vSymbol: debt.vSymbol, asset: debt.symbol, borrow: debt.borrow, borrowUsd: debt.borrowUsd },
    repayNeeded: { amount: formatUnits(neededRaw, debt.decimals), usd: repayUsd },
    walletBalance: formatUnits(walletBal, debt.decimals),
  };

  if (repayRaw === 0n) {
    return {
      ...base,
      mode: execute ? 'executed' : 'dry-run',
      action: 'insufficient-balance',
      ...detail,
      note: `wallet holds no spare ${debt.symbol} to repay with — acquire ${formatUnits(neededRaw, debt.decimals)} ${debt.symbol} (e.g. bsc-defi swap) and re-run`,
    };
  }

  const repayUsdActual = Number(formatUnits(repayRaw * debt.priceMantissa, 36));
  const projectedHf = hfAfterRepay(snap.weightedCollateralUsd, snap.borrowUsd, repayUsdActual);
  const partial = repayRaw < neededRaw;

  const steps = [];
  if (!debt.native) {
    const approval = await approvalStepIfNeeded({
      client, token: debt.underlying, owner: account.address, spender: debt.vToken,
      amount: repayRaw, erc20Abi,
      label: `approve ${formatUnits(repayRaw, debt.decimals)} ${debt.symbol} for ${debt.vSymbol}`,
    });
    if (approval) steps.push(approval);
  }
  steps.push({
    label: `repay ${formatUnits(repayRaw, debt.decimals)} ${debt.symbol} of ${debt.vSymbol} borrow${partial ? ' (partial — wallet balance is the limit)' : ''}`,
    address: debt.vToken,
    abi: debt.native ? vBnbAbi : vTokenAbi,
    functionName: 'repayBorrow',
    args: debt.native ? [] : [repayRaw],
    ...(debt.native ? { value: repayRaw } : {}),
    expectZeroResult: !debt.native,
    needs: steps.length > 0 ? [0] : [],
  });

  const result = await runWriteChain({
    command: 'health protect',
    detail: {
      ...detail,
      minHf,
      repayPlanned: { amount: formatUnits(repayRaw, debt.decimals), usd: repayUsdActual, partial },
      projectedHf,
    },
    steps,
    execute,
  });

  if (execute) {
    const after = await accountSnapshot(client, cfg, account.address);
    result.resultingHealthFactor = after.hf;
    result.resultingShortfallUsd = after.shortfallUsd;
  }
  return result;
}
