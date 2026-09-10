// The known token list = native BNB + WBNB + every Venus market underlying.
// Nothing beyond addresses is pinned: symbols/decimals/underlyings resolve at
// runtime, so a re-deployed testnet token can't silently skew amounts.

import { getAddress, isAddress } from 'viem';
import { erc20Abi } from './abi/erc20.mjs';
import { comptrollerAbi, vTokenAbi } from './abi/venus.mjs';
import { CliError } from './util.mjs';

/** Venus market addresses for a chain: pinned on 97, getAllMarkets on 56. */
export async function venusMarkets(client, cfg) {
  if (cfg.venus.vTokens) return Object.values(cfg.venus.vTokens);
  const markets = await client.readContract({
    address: cfg.venus.comptroller,
    abi: comptrollerAbi,
    functionName: 'getAllMarkets',
  });
  return [...markets];
}

/**
 * Resolve the token list. Entries:
 *   { symbol, address (null = native BNB), decimals, native, vToken? }
 * vBNB has no underlying() — its failure marks the native market.
 */
export async function tokenList(client, cfg) {
  const markets = await venusMarkets(client, cfg);
  const underlyings = await client.multicall({
    contracts: markets.map((vToken) => ({
      address: vToken,
      abi: vTokenAbi,
      functionName: 'underlying',
    })),
    allowFailure: true,
  });

  const tokens = [
    { symbol: 'BNB', address: null, decimals: 18, native: true },
    { symbol: 'WBNB', address: getAddress(cfg.wbnb), decimals: 18, native: false },
  ];

  const erc20Markets = [];
  for (let i = 0; i < markets.length; i++) {
    if (underlyings[i].status === 'success') {
      erc20Markets.push({ vToken: markets[i], underlying: getAddress(underlyings[i].result) });
    } else {
      // underlying() reverted → native market (vBNB)
      tokens[0].vToken = markets[i];
    }
  }

  if (erc20Markets.length > 0) {
    const meta = await client.multicall({
      contracts: erc20Markets.flatMap(({ underlying }) => [
        { address: underlying, abi: erc20Abi, functionName: 'symbol' },
        { address: underlying, abi: erc20Abi, functionName: 'decimals' },
      ]),
      allowFailure: true,
    });
    erc20Markets.forEach(({ vToken, underlying }, i) => {
      const sym = meta[i * 2];
      const dec = meta[i * 2 + 1];
      if (sym.status !== 'success' || dec.status !== 'success') return;
      if (underlying.toLowerCase() === cfg.wbnb.toLowerCase()) {
        tokens[1].vToken = vToken; // a WBNB market supplements the WBNB entry
        return;
      }
      tokens.push({
        symbol: sym.result,
        address: underlying,
        decimals: Number(dec.result),
        native: false,
        vToken,
      });
    });
  }

  return tokens;
}

/**
 * `--in USDT` / `--out 0xabc…` → token entry. Symbols are matched
 * case-insensitively against the known list; a 0x address is resolved live.
 */
export async function resolveToken(client, cfg, spec, tokens = null) {
  const raw = String(spec).trim();
  if (isAddress(raw)) {
    const addr = getAddress(raw);
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: addr, abi: erc20Abi, functionName: 'symbol' }),
      client.readContract({ address: addr, abi: erc20Abi, functionName: 'decimals' }),
    ]).catch(() => {
      throw new CliError(`${raw} does not answer symbol()/decimals() — not an ERC-20?`);
    });
    return { symbol, address: addr, decimals: Number(decimals), native: false };
  }
  const list = tokens ?? (await tokenList(client, cfg));
  const hit = list.find((t) => t.symbol.toLowerCase() === raw.toLowerCase());
  if (!hit) {
    throw new CliError(
      `unknown token "${raw}" — known: ${list.map((t) => t.symbol).join(', ')} (or pass a 0x address)`,
    );
  }
  return hit;
}

/** Parse "A/B" into two resolved tokens. */
export async function resolvePair(client, cfg, pairSpec) {
  const parts = String(pairSpec).split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CliError(`--pair must be "<A>/<B>", got "${pairSpec}"`);
  }
  const tokens = await tokenList(client, cfg);
  const a = await resolveToken(client, cfg, parts[0], tokens);
  const b = await resolveToken(client, cfg, parts[1], tokens);
  if ((a.address ?? 'BNB') === (b.address ?? 'BNB')) {
    throw new CliError(`--pair needs two different tokens, got ${pairSpec}`);
  }
  return { a, b };
}

/** ERC-20 address a token trades as on PCS (native BNB trades as WBNB). */
export function tradeAddress(token, cfg) {
  return token.native ? getAddress(cfg.wbnb) : token.address;
}
