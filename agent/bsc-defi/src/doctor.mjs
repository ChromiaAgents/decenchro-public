// `bsc-defi doctor` — is this deployment pointed at a sane chain?
//   - RPC reachable + latency
//   - eth_chainId matches BSC_CHAIN_ID
//   - eth_getCode at every pinned address (ok / MISSING per contract)
// Exit 1 (from bin) when anything is missing or mismatched.

import { chainId } from './env.mjs';
import { chainConfig, pinnedContracts } from './chains.mjs';
import { publicClient, activeRpc, maybeAccount } from './tx.mjs';

export async function cmdDoctor() {
  const expected = chainId();
  const cfg = chainConfig(expected);
  const client = publicClient(cfg);

  const t0 = Date.now();
  const [actualChainId, blockNumber] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
  ]);
  const latencyMs = Date.now() - t0;

  const pins = pinnedContracts(cfg);
  const names = Object.keys(pins);
  const codes = await Promise.all(
    names.map((name) => client.getCode({ address: pins[name] }).catch(() => null)),
  );

  const contracts = names.map((name, i) => ({
    name,
    address: pins[name],
    ok: Boolean(codes[i] && codes[i] !== '0x'),
  }));
  const missing = contracts.filter((c) => !c.ok);
  const chainOk = actualChainId === expected;
  const ok = chainOk && missing.length === 0;

  return {
    command: 'doctor',
    ok,
    ...(ok ? {} : {
      error: [
        ...(chainOk ? [] : [`chain id mismatch: RPC says ${actualChainId}, BSC_CHAIN_ID says ${expected}`]),
        ...(missing.length ? [`${missing.length} pinned contract(s) MISSING: ${missing.map((c) => c.name).join(', ')}`] : []),
      ].join('; '),
    }),
    chain: { expected, actual: actualChainId, ok: chainOk, label: cfg.label },
    rpc: { url: activeRpc(cfg), latencyMs, blockNumber },
    signer: maybeAccount()
      ? { configured: true, address: maybeAccount().address }
      : { configured: false, note: 'BSC_AGENT_KEY not set — read-only' },
    contracts,
  };
}
