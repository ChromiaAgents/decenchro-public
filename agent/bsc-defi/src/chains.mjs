// Pinned protocol addresses per chain. `bsc-defi doctor` re-verifies every
// one of these against the live RPC (eth_getCode) at runtime, so drift shows
// up as a named MISSING line rather than a cryptic revert.
//
// Chain 97 pins were verified live on 2026-08-20 against
// https://bsc-testnet-rpc.publicnode.com: all 12 have code, all five vTokens
// are listed in the comptroller's getAllMarkets, and the v2 router's WETH()
// matches the WBNB pin. Two pins from the docs were CORRECTED against the
// live chains (getCode + name()/WETH9() probes) — see inline notes.

import { bsc, bscTestnet } from 'viem/chains';
import { CliError } from './util.mjs';

export const CHAINS = {
  97: {
    id: 97,
    label: 'bsc-testnet',
    chain: bscTestnet,
    defaultRpc: 'https://bsc-testnet-rpc.publicnode.com',
    explorer: 'https://testnet.bscscan.com',
    faucet: 'https://www.bnbchain.org/en/testnet-faucet',
    blocksPerYear: 10_512_000,
    wbnb: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
    pcs: {
      v3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
      // Corrected 2026-08-20: the mainnet NPM address (0x46A1…F4364) holds a
      // DIFFERENT contract on testnet (name()/balanceOf revert). This one
      // answers name() = "Pancake V3 Positions NFT-V1" and points at the
      // pinned v3 factory + WBNB.
      v3PositionManager: '0x427bF5b37357632377eCbEC9de3626C71A5396c1',
      v3SwapRouter: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
      v2Router: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
      v2Factory: '0x6725F303b657a9451d8BA641348b6761A6CC7a17',
    },
    venus: {
      comptroller: '0x94d1820b2D1c7c7452A163983Dc888CEC546b77D',
      // Underlyings are resolved at runtime via underlying() (vBNB is native).
      vTokens: {
        vBNB: '0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c',
        vUSDT: '0xb7526572FFE56AB9D7489838Bf2E18e3323b441A',
        vUSDC: '0xD5C4C2e2facBEB59D0216D0595d63FcDc6F9A1a7',
        vBTC: '0xb6e9322C49FD75a367Fcb17B0Fcd62C5070EbCBe',
        vETH: '0x162D005F0Fff510E54958Cfc5CF32A3180A84aab',
      },
    },
  },
  56: {
    id: 56,
    label: 'bsc-mainnet',
    chain: bsc,
    defaultRpc: 'https://bsc-rpc.publicnode.com',
    explorer: 'https://bscscan.com',
    faucet: null,
    blocksPerYear: 10_512_000,
    // Corrected 2026-08-20: the commonly quoted 0xbb4C…F0Ee75 has NO code on
    // the live chain; this is what the pinned v2 router's WETH() returns and
    // it carries WBNB bytecode. doctor re-checks on every run.
    wbnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    pcs: {
      // v3 factory + swap router share addresses with chain 97; the NPM does
      // NOT (verified live: name() = "Pancake V3 Positions NFT-V1" here).
      v3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
      v3PositionManager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364',
      v3SwapRouter: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
      v2Router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      v2Factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    },
    venus: {
      comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
      // Mainnet market set moves — resolve via comptroller.getAllMarkets().
      vTokens: null,
    },
  },
};

export function chainConfig(id) {
  const cfg = CHAINS[id];
  if (!cfg) throw new CliError(`unsupported chain id ${id} — expected 97 or 56`);
  return cfg;
}

/** name → address map of every pinned contract on a chain (doctor's list). */
export function pinnedContracts(cfg) {
  const out = {
    'pcs.v3Factory': cfg.pcs.v3Factory,
    'pcs.v3PositionManager': cfg.pcs.v3PositionManager,
    'pcs.v3SwapRouter': cfg.pcs.v3SwapRouter,
    'pcs.v2Router': cfg.pcs.v2Router,
    'pcs.v2Factory': cfg.pcs.v2Factory,
    wbnb: cfg.wbnb,
    'venus.comptroller': cfg.venus.comptroller,
  };
  if (cfg.venus.vTokens) {
    for (const [name, addr] of Object.entries(cfg.venus.vTokens)) {
      out[`venus.${name}`] = addr;
    }
  }
  return out;
}
