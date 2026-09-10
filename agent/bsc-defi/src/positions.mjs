// `bsc-defi positions [--address 0x…]` — the whole portfolio in one read:
// PCS v3 LP NFTs (range, in-range flag, live unclaimed fees via a static
// collect) + Venus supply/borrow balances with health factor.

import { formatUnits } from 'viem';
import { chainId } from './env.mjs';
import { chainConfig } from './chains.mjs';
import { publicClient, ownerAddress } from './tx.mjs';
import { accountSnapshot } from './venus.mjs';
import { npmAbi, v3FactoryAbi, v3PoolAbi, MAX_UINT128 } from './abi/v3.mjs';
import { erc20Abi } from './abi/erc20.mjs';

export async function listV3Positions(client, cfg, owner) {
  const npm = cfg.pcs.v3PositionManager;
  const count = await client.readContract({
    address: npm, abi: npmAbi, functionName: 'balanceOf', args: [owner],
  });
  if (count === 0n) return [];

  const ids = await client.multicall({
    contracts: Array.from({ length: Number(count) }, (_v, i) => ({
      address: npm, abi: npmAbi, functionName: 'tokenOfOwnerByIndex', args: [owner, BigInt(i)],
    })),
    allowFailure: false,
  });

  const raw = await client.multicall({
    contracts: ids.map((id) => ({ address: npm, abi: npmAbi, functionName: 'positions', args: [id] })),
    allowFailure: false,
  });

  // token metadata + pool per position
  const tokenAddrs = [...new Set(raw.flatMap((p) => [p[2], p[3]]))];
  const meta = await client.multicall({
    contracts: tokenAddrs.flatMap((t) => [
      { address: t, abi: erc20Abi, functionName: 'symbol' },
      { address: t, abi: erc20Abi, functionName: 'decimals' },
    ]),
    allowFailure: true,
  });
  const tokenInfo = Object.fromEntries(tokenAddrs.map((t, i) => [t.toLowerCase(), {
    address: t,
    symbol: meta[i * 2].status === 'success' ? meta[i * 2].result : t,
    decimals: meta[i * 2 + 1].status === 'success' ? Number(meta[i * 2 + 1].result) : 18,
  }]));

  const pools = await client.multicall({
    contracts: raw.map((p) => ({
      address: cfg.pcs.v3Factory, abi: v3FactoryAbi, functionName: 'getPool', args: [p[2], p[3], p[4]],
    })),
    allowFailure: false,
  });
  const slots = await client.multicall({
    contracts: pools.map((pool) => ({ address: pool, abi: v3PoolAbi, functionName: 'slot0' })),
    allowFailure: true,
  });

  // Live unclaimed fees: static-call collect(max) as the owner.
  const fees = await Promise.all(ids.map((id) =>
    client.simulateContract({
      address: npm, abi: npmAbi, functionName: 'collect',
      args: [{ tokenId: id, recipient: owner, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
      account: owner,
    }).then((r) => r.result).catch(() => null),
  ));

  return ids.map((id, i) => {
    const p = raw[i];
    const t0 = tokenInfo[p[2].toLowerCase()];
    const t1 = tokenInfo[p[3].toLowerCase()];
    const slot = slots[i].status === 'success' ? slots[i].result : null;
    const currentTick = slot ? Number(slot[1]) : null;
    const tickLower = Number(p[5]);
    const tickUpper = Number(p[6]);
    return {
      tokenId: id,
      pool: pools[i],
      token0: { symbol: t0.symbol, address: t0.address },
      token1: { symbol: t1.symbol, address: t1.address },
      fee: Number(p[4]),
      tickLower,
      tickUpper,
      currentTick,
      inRange: currentTick === null ? null : currentTick >= tickLower && currentTick < tickUpper,
      liquidity: p[7],
      unclaimedFees: fees[i]
        ? {
            [t0.symbol]: formatUnits(fees[i][0], t0.decimals),
            [t1.symbol]: formatUnits(fees[i][1], t1.decimals),
          }
        : null,
    };
  });
}

export async function cmdPositions(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const owner = ownerAddress(flags);

  const [v3, venus] = await Promise.all([
    listV3Positions(client, cfg, owner),
    accountSnapshot(client, cfg, owner),
  ]);

  const activeMarkets = venus.markets.filter((m) => m.supplyRaw > 0n || m.borrowRaw > 0n);
  return {
    command: 'positions',
    chainId: cfg.id,
    owner,
    pancakeV3: v3,
    venus: {
      healthFactor: venus.hf,
      weightedCollateralUsd: venus.weightedCollateralUsd,
      borrowUsd: venus.borrowUsd,
      liquidityUsd: venus.liquidityUsd,
      shortfallUsd: venus.shortfallUsd,
      markets: activeMarkets.map((m) => ({
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
    },
  };
}
