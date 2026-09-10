// `bsc-defi wallet` — address, native balance, known-token balances.
// Shows the address ONLY, never key material.

import { formatUnits } from 'viem';
import { chainId } from './env.mjs';
import { chainConfig } from './chains.mjs';
import { publicClient, ownerAddress } from './tx.mjs';
import { tokenList } from './tokens.mjs';
import { erc20Abi } from './abi/erc20.mjs';

export async function cmdWallet(flags) {
  const cfg = chainConfig(chainId());
  const client = publicClient(cfg);
  const address = ownerAddress(flags);

  const [native, tokens] = await Promise.all([
    client.getBalance({ address }),
    tokenList(client, cfg),
  ]);

  const erc20s = tokens.filter((t) => !t.native);
  const balances = await client.multicall({
    contracts: erc20s.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    })),
    allowFailure: true,
  });

  return {
    command: 'wallet',
    chainId: cfg.id,
    address,
    native: { symbol: 'BNB', balance: formatUnits(native, 18), wei: native },
    tokens: erc20s.map((t, i) => ({
      symbol: t.symbol,
      address: t.address,
      decimals: t.decimals,
      balance: balances[i].status === 'success' ? formatUnits(balances[i].result, t.decimals) : null,
    })),
    ...(cfg.id === 97
      ? { faucet: `no tBNB? top up at ${cfg.faucet} (needs ~0.1 tBNB for gas + testing)` }
      : {}),
  };
}
