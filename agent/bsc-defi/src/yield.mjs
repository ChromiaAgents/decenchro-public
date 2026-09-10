// Venus yield:
//   yield scan [--reference mainnet]  rank markets by supply APY (on-chain
//                                     rates; APY compounded daily per Venus docs)
//   yield move --asset SYM --to vTOK  redeem from the asset's market, mint
//                                     into the target market

import { formatUnits } from 'viem';
import { chainId } from './env.mjs';
import { chainConfig } from './chains.mjs';
import { publicClient, requireAccount, runWriteChain, approvalStepIfNeeded } from './tx.mjs';
import { marketMeta } from './venus.mjs';
import { venusApyPercent } from './math.mjs';
import { erc20Abi } from './abi/erc20.mjs';
import { vTokenAbi, vBnbAbi } from './abi/venus.mjs';
import { CliError, requireFlag } from './util.mjs';

function rankMarkets(meta, cfg) {
  return meta
    .filter((m) => m.listed)
    .map((m) => ({
      vToken: m.vToken,
      vSymbol: m.vSymbol,
      asset: m.symbol,
      supplyApyPct: m.supplyRatePerBlock === null
        ? null
        : Number(venusApyPercent(m.supplyRatePerBlock, cfg.blocksPerYear).toFixed(4)),
      borrowApyPct: m.borrowRatePerBlock === null
        ? null
        : Number(venusApyPercent(m.borrowRatePerBlock, cfg.blocksPerYear).toFixed(4)),
      collateralFactor: m.collateralFactor,
    }))
    .sort((x, y) => (y.supplyApyPct ?? -1) - (x.supplyApyPct ?? -1));
}

export async function cmdYieldScan(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const meta = await marketMeta(client, cfg);
  const out = {
    command: 'yield scan',
    chainId: cfg.id,
    blocksPerYear: cfg.blocksPerYear,
    markets: rankMarkets(meta, cfg),
  };

  if (flags.reference === 'mainnet' && cfg.id !== 56) {
    const refCfg = chainConfig(56);
    try {
      // Read-only look at mainnet rates for comparison — always the default
      // RPC (BSC_RPC_URL only overrides the ACTIVE chain), never any writes.
      const refClient = publicClient(refCfg, refCfg.defaultRpc);
      const refMeta = await marketMeta(refClient, refCfg);
      out.reference = { chainId: 56, label: 'mainnet (read-only reference)', markets: rankMarkets(refMeta, refCfg) };
    } catch (e) {
      out.reference = { chainId: 56, error: `mainnet reference unavailable: ${e.shortMessage || e.message}` };
    }
  }
  return out;
}

export async function cmdYieldMove(flags) {
  const usage = 'yield move --asset USDT --to vUSDC [--execute]';
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const account = requireAccount();
  const execute = flags.execute === true;

  const assetSym = requireFlag(flags, 'asset', usage);
  const toSpec = requireFlag(flags, 'to', usage);
  const meta = await marketMeta(client, cfg);

  const source = meta.find((m) => m.symbol.toLowerCase() === assetSym.toLowerCase());
  if (!source) {
    throw new CliError(`no Venus market for asset "${assetSym}" — markets: ${meta.map((m) => m.symbol).join(', ')}`);
  }
  const target = meta.find(
    (m) => m.vToken.toLowerCase() === toSpec.toLowerCase() || m.vSymbol.toLowerCase() === toSpec.toLowerCase(),
  );
  if (!target) {
    throw new CliError(`unknown target market "${toSpec}" — vTokens: ${meta.map((m) => m.vSymbol).join(', ')}`);
  }
  if (source.vToken.toLowerCase() === target.vToken.toLowerCase()) {
    throw new CliError(`asset ${source.symbol} already lives in ${target.vSymbol} — nothing to move`);
  }

  const [vBal, rate] = await Promise.all([
    client.readContract({ address: source.vToken, abi: vTokenAbi, functionName: 'balanceOf', args: [account.address] }),
    client.readContract({ address: source.vToken, abi: vTokenAbi, functionName: 'exchangeRateStored' }),
  ]);
  const redeemedEstimate = (vBal * rate) / 10n ** 18n;

  const steps = [];
  let redeemIdx = null;
  if (vBal > 0n) {
    redeemIdx = steps.length;
    steps.push({
      label: `redeem ${formatUnits(vBal, 8)} ${source.vSymbol} (≈${formatUnits(redeemedEstimate, source.decimals)} ${source.symbol})`,
      address: source.vToken,
      abi: source.native ? vBnbAbi : vTokenAbi,
      functionName: 'redeem',
      args: [vBal],
      expectZeroResult: !source.native,
      wantResult: true,
    });
  }

  // What can be minted into the target: the wallet's current balance of the
  // target underlying, plus the redeem proceeds when the asset matches.
  const sameAsset = target.symbol.toLowerCase() === source.symbol.toLowerCase();
  const walletBal = target.native
    ? await client.getBalance({ address: account.address })
    : await client.readContract({ address: target.underlying, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
  const gasReserve = target.native ? 5_000_000_000_000_000n : 0n; // keep 0.005 BNB for gas
  const available = walletBal > gasReserve ? walletBal - gasReserve : 0n;
  const mintAmount = available + (sameAsset && redeemIdx !== null ? redeemedEstimate : 0n);

  if (mintAmount === 0n && redeemIdx === null) {
    return {
      command: 'yield move', chainId: cfg.id, mode: execute ? 'executed' : 'dry-run',
      action: 'none',
      note: `nothing supplied in ${source.vSymbol} and no ${target.symbol} in the wallet — swap ${source.symbol} → ${target.symbol} first`,
    };
  }

  if (mintAmount > 0n) {
    if (!target.native) {
      const approval = await approvalStepIfNeeded({
        client, token: target.underlying, owner: account.address, spender: target.vToken,
        amount: mintAmount, erc20Abi,
        label: `approve ${formatUnits(mintAmount, target.decimals)} ${target.symbol} for ${target.vSymbol}`,
      });
      if (approval) {
        approval.needs = sameAsset && redeemIdx !== null ? [redeemIdx] : [];
        steps.push(approval);
      }
    }
    const mintNeeds = steps.map((_s, i) => i);
    steps.push({
      label: `mint ${formatUnits(mintAmount, target.decimals)} ${target.symbol} into ${target.vSymbol}`,
      address: target.vToken,
      abi: target.native ? vBnbAbi : vTokenAbi,
      functionName: 'mint',
      args: target.native ? [] : [mintAmount],
      ...(target.native ? { value: mintAmount } : {}),
      expectZeroResult: !target.native,
      needs: mintNeeds,
    });
  }

  const result = await runWriteChain({
    command: 'yield move',
    detail: {
      asset: source.symbol,
      from: { vToken: source.vToken, vSymbol: source.vSymbol, redeemEstimate: formatUnits(redeemedEstimate, source.decimals) },
      to: { vToken: target.vToken, vSymbol: target.vSymbol, mintAmount: formatUnits(mintAmount, target.decimals) },
      ...(sameAsset ? {} : {
        note: `cross-asset move: proceeds stay as ${source.symbol} — swap ${source.symbol} → ${target.symbol} and re-run to mint them too`,
      }),
    },
    steps,
    execute,
  });
  return result;
}
