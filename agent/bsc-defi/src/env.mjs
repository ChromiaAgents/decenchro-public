// Environment contract. All knobs are injected by the platform (Render env
// vars → cont-init MANAGED block → ~/.hermes/.env → this process).
//
//   BSC_AGENT_KEY         0x-hex secp256k1 private key (never printed)
//   BSC_CHAIN_ID          97 (default) or 56
//   BSC_RPC_URL           optional; defaults to publicnode per chain
//   BSC_MAX_SLIPPAGE_BPS  default 100 (1%)
//   BSC_MAX_SPEND_BNB     default 0.5 — cap on BNB/WBNB leaving per invocation
//   BSC_MAINNET_OK        must be "1" for ANY write on chain 56
//   BSC_STATE_DIR         grid/state dir; default $HERMES_HOME/workspace/.bsc-defi

import path from 'node:path';
import { CliError } from './util.mjs';

export function chainId() {
  const raw = process.env.BSC_CHAIN_ID ?? '97';
  const id = Number(raw);
  if (id !== 97 && id !== 56) {
    throw new CliError(`BSC_CHAIN_ID must be 97 or 56, got "${raw}"`);
  }
  return id;
}

export function rpcOverride() {
  return process.env.BSC_RPC_URL || null;
}

/** Raw key or null. Validated shape only — the value itself is never echoed. */
export function agentKey() {
  const key = process.env.BSC_AGENT_KEY;
  if (!key) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new CliError('BSC_AGENT_KEY is set but is not a 0x-prefixed 32-byte hex key');
  }
  return key;
}

export function maxSlippageBps() {
  const raw = process.env.BSC_MAX_SLIPPAGE_BPS ?? '100';
  const bps = Number(raw);
  if (!Number.isInteger(bps) || bps < 0 || bps > 5000) {
    throw new CliError(`BSC_MAX_SLIPPAGE_BPS must be an integer 0-5000, got "${raw}"`);
  }
  return bps;
}

export function maxSpendBnb() {
  const raw = process.env.BSC_MAX_SPEND_BNB ?? '0.5';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CliError(`BSC_MAX_SPEND_BNB must be a positive number, got "${raw}"`);
  }
  return raw;
}

export function mainnetOk() {
  return process.env.BSC_MAINNET_OK === '1';
}

export function stateDir() {
  if (process.env.BSC_STATE_DIR) return process.env.BSC_STATE_DIR;
  const hermesHome = process.env.HERMES_HOME;
  return hermesHome
    ? path.join(hermesHome, 'workspace', '.bsc-defi')
    : path.resolve('.bsc-defi');
}
