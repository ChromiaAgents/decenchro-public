// `bsc-defi help [cmd]` — JSON like everything else, so the agent can quote it.

import { CliError } from './util.mjs';

const COMMANDS = {
  wallet: {
    usage: 'bsc-defi wallet [--address 0x…]',
    what: 'agent address, native BNB balance, balances of the known token list (Venus underlyings + WBNB); faucet hint on chain 97',
    readOnly: true,
  },
  doctor: {
    usage: 'bsc-defi doctor',
    what: 'RPC latency, eth_chainId vs BSC_CHAIN_ID, eth_getCode on every pinned contract — exit 1 if anything is missing',
    readOnly: true,
  },
  positions: {
    usage: 'bsc-defi positions [--address 0x…]',
    what: 'PancakeSwap v3 LP NFTs (range, in-range flag, unclaimed fees) + Venus balances with health factor',
    readOnly: true,
  },
  swap: {
    usage: 'bsc-defi swap --in <SYM> --out <SYM> --amount <n> [--execute]',
    what: 'PCS v2 exact-in swap, slippage-capped by BSC_MAX_SLIPPAGE_BPS; BNB wraps/unwraps automatically; approves inside the same invocation when needed',
    example: 'bsc-defi swap --in BNB --out USDT --amount 0.05',
  },
  'lp add': {
    usage: 'bsc-defi lp add --pair <A/B> [--fee 2500] [--range -5%..+5%|<tickLo>..<tickHi>] --amount0 <A amount> --amount1 <B amount> [--price <B per A>] [--execute]',
    what: 'mint a v3 position; creates + initializes the pool when absent (price from --price or the v2 mid)',
  },
  'lp remove': {
    usage: 'bsc-defi lp remove --id <tokenId> [--execute]',
    what: 'decrease full liquidity, collect principal + fees, burn the NFT',
  },
  'lp rebalance': {
    usage: 'bsc-defi lp rebalance --id <tokenId> [--width 10%] [--execute]',
    what: 'remove the position and re-mint it centered on the current tick',
  },
  'grid init': {
    usage: 'bsc-defi grid init --pair <A/B> --lower <p> --upper <p> --levels <n> --size <A per level> [--force]',
    what: 'write the grid state file — no chain writes; prices are units of B per A',
  },
  'grid run': {
    usage: 'bsc-defi grid run [--pair A/B] [--execute]',
    what: 'read the v2 price and trade each level crossed since the last run (up = sell A, down = buy A); idempotent via the state file',
  },
  'grid status': {
    usage: 'bsc-defi grid status [--pair A/B]',
    what: 'grid config, last/current price, pending crossings, recent fills',
    readOnly: true,
  },
  'yield scan': {
    usage: 'bsc-defi yield scan [--reference mainnet]',
    what: 'rank Venus markets by supply APY (rate/1e18 × blocks-per-day, compounded daily, 10,512,000 blocks/yr); --reference mainnet adds read-only chain-56 rates',
    readOnly: true,
  },
  'yield move': {
    usage: 'bsc-defi yield move --asset <SYM> --to <vToken> [--execute]',
    what: 'redeem the asset from its Venus market, mint into the target market (cross-asset moves need a swap in between)',
  },
  'health check': {
    usage: 'bsc-defi health check [--address 0x…]',
    what: 'Venus health factor = Σ(supply × collateralFactor) / Σ(borrows), plus account liquidity/shortfall and per-market detail',
    readOnly: true,
  },
  'health protect': {
    usage: 'bsc-defi health protect [--min-hf 1.5] [--execute]',
    what: 'if HF < min: repay the largest borrow from the wallet balance of that asset to lift HF back over the floor; reports insufficient balance instead of improvising',
  },
  help: { usage: 'bsc-defi help [cmd]', what: 'this text', readOnly: true },
};

const RULES = [
  'every mutating command is a DRY-RUN by default and prints a plan; add --execute to send',
  'every write is simulated first, on the dry-run AND the execute path',
  'one write chain per invocation; each tx is confirmed (waitForTransactionReceipt) before the next',
  'BNB/WBNB leaving the wallet is capped per invocation by BSC_MAX_SPEND_BNB (default 0.5)',
  'slippage is capped by BSC_MAX_SLIPPAGE_BPS (default 100 = 1%)',
  'writes on chain 56 additionally require BSC_MAINNET_OK=1',
  'without BSC_AGENT_KEY the CLI is read-only (reads accept --address); the key is never printed',
  'all output is JSON on stdout; failures are {"error": …} with exit code 1',
];

export function cmdHelp(words) {
  if (words.length > 0) {
    const key = words.join(' ');
    const hit = COMMANDS[key] ?? COMMANDS[words[0]];
    if (!hit) throw new CliError(`no such command "${key}" — run bsc-defi help`);
    return { command: 'help', topic: key, ...hit, rules: RULES };
  }
  return {
    command: 'help',
    name: 'bsc-defi',
    what: 'PancakeSwap v2/v3 + Venus for Decenchro agents on BNB Chain (testnet 97 by default)',
    rules: RULES,
    commands: Object.fromEntries(Object.entries(COMMANDS).map(([k, v]) => [k, v.usage])),
  };
}
