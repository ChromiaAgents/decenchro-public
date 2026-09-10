// Clients + the write chain. THE safety chokepoint:
//
//   - every mutating command is dry-run by default; --execute sends
//   - simulateContract before EVERY write, on both paths
//   - one write chain per process invocation, each write awaited via
//     waitForTransactionReceipt before the next (nonce safety, clean audit)
//   - chain 56 writes additionally require BSC_MAINNET_OK=1
//   - BNB leaving the wallet (native value or WBNB spend) is capped by
//     BSC_MAX_SPEND_BNB per invocation
//   - the private key is used to derive the account and sign — it is never
//     part of any output

import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { agentKey, chainId, mainnetOk, maxSpendBnb, rpcOverride } from './env.mjs';
import { chainConfig } from './chains.mjs';
import { CliError, READ_ONLY_ERROR } from './util.mjs';

export function activeRpc(cfg) {
  return rpcOverride() || cfg.defaultRpc;
}

/** Public client for the active chain (or an explicit config, e.g. yield --reference). */
export function publicClient(cfg = chainConfig(chainId()), rpcUrl = null) {
  return createPublicClient({
    chain: cfg.chain,
    transport: http(rpcUrl || activeRpc(cfg), { timeout: 20_000, batch: true }),
  });
}

/** Signing account, or null when BSC_AGENT_KEY is unset. */
export function maybeAccount() {
  const key = agentKey();
  return key ? privateKeyToAccount(key) : null;
}

export function requireAccount() {
  const account = maybeAccount();
  if (!account) throw new CliError(READ_ONLY_ERROR);
  return account;
}

/**
 * Owner address for read commands: --address if given, else the signer.
 * Lets positions/health/wallet-style reads work without a key.
 */
export function ownerAddress(flags) {
  const explicit = flags?.address;
  if (explicit && explicit !== true) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(explicit)) {
      throw new CliError(`--address is not a valid address: ${explicit}`);
    }
    return explicit;
  }
  const account = maybeAccount();
  if (!account) {
    throw new CliError(`${READ_ONLY_ERROR} — pass --address 0x… to inspect a wallet read-only`);
  }
  return account.address;
}

function walletClient(cfg, account) {
  return createWalletClient({
    chain: cfg.chain,
    account,
    transport: http(activeRpc(cfg), { timeout: 20_000 }),
  });
}

/**
 * Run a mutating command's step list.
 *
 * step: {
 *   label       human step name (shows up in the plan and the audit trail)
 *   address, abi, functionName, args, value?
 *   needs?      indices of steps that must land first — their state change is
 *               a precondition, so a dry run can't truthfully simulate this
 *               step and marks it pending instead
 *   spendWei?   WBNB/BNB outflow beyond `value` counted against the cap
 *   expectZeroResult?  Venus-style error-code returns: simulation must be 0n
 * }
 *
 * Dry-run (default): simulates every step it can, prints the plan, exit 0.
 * --execute: simulate → write → waitForTransactionReceipt per step, in order.
 */
export async function runWriteChain({ command, detail = {}, steps, execute }) {
  const id = chainId();
  const cfg = chainConfig(id);
  const account = requireAccount();

  if (id === 56 && !mainnetOk()) {
    throw new CliError('writes on BSC mainnet (56) are disabled — set BSC_MAINNET_OK=1 to enable');
  }

  const cap = parseEther(maxSpendBnb());
  const spend = steps.reduce((sum, s) => sum + (s.value ?? 0n) + (s.spendWei ?? 0n), 0n);
  if (spend > cap) {
    throw new CliError(
      `this invocation would move ${formatEther(spend)} BNB/WBNB, over BSC_MAX_SPEND_BNB=${maxSpendBnb()}`,
    );
  }

  const client = publicClient(cfg);
  const wallet = execute ? walletClient(cfg, account) : null;
  const landed = new Set();
  const report = [];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const request = {
      address: s.address,
      abi: s.abi,
      functionName: s.functionName,
      args: s.args,
      account,
      ...(s.value !== undefined ? { value: s.value } : {}),
    };
    const base = {
      step: i + 1,
      label: s.label,
      to: s.address,
      function: s.functionName,
      ...(s.value !== undefined ? { valueWei: s.value } : {}),
    };

    const simulate = async () => {
      const { result } = await client.simulateContract(request);
      if (s.expectZeroResult && typeof result === 'bigint' && result !== 0n) {
        throw new CliError(`${s.label}: protocol returned error code ${result} (Venus Compound-style failure)`);
      }
      return result;
    };

    if (!execute) {
      const pending = (s.needs ?? []).filter((n) => !landed.has(n));
      if (pending.length > 0) {
        report.push({
          ...base,
          simulated: false,
          note: `simulation deferred — depends on step ${pending.map((n) => n + 1).join(', ')} landing first`,
        });
      } else {
        try {
          const result = await simulate();
          report.push({ ...base, simulated: true, ...(s.wantResult ? { simulatedResult: result } : {}) });
        } catch (e) {
          throw new CliError(`${s.label}: simulation reverted — ${e.shortMessage || e.message}`);
        }
      }
      continue;
    }

    // Execute path: simulate-first, then send, then wait. A revert here stops
    // the chain — later steps are NOT attempted.
    let simulated;
    try {
      simulated = await simulate();
    } catch (e) {
      if (e instanceof CliError) throw e;
      throw new CliError(`${s.label}: pre-send simulation reverted — ${e.shortMessage || e.message}`);
    }
    const hash = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new CliError(`${s.label}: transaction reverted on-chain (${hash})`);
    }
    landed.add(i);
    report.push({
      ...base,
      txHash: hash,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      blockNumber: receipt.blockNumber,
      ...(s.wantResult ? { simulatedResult: simulated } : {}),
    });
    if (s.afterReceipt) await s.afterReceipt({ hash, receipt });
  }

  return {
    command,
    chainId: id,
    mode: execute ? 'executed' : 'dry-run',
    from: account.address,
    ...detail,
    steps: report,
    ...(execute ? {} : { hint: 'plan only — re-run with --execute to send' }),
  };
}

/** ERC-20 approval step iff current allowance is below `amount`. */
export async function approvalStepIfNeeded({ client, token, owner, spender, amount, erc20Abi, label }) {
  const allowance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  });
  if (allowance >= amount) return null;
  return {
    label: label || `approve ${token} for ${spender}`,
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  };
}
