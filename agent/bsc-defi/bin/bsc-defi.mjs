#!/usr/bin/env node
// bsc-defi — BSC DeFi CLI for Decenchro agents.
//
// Verbs come first in argv on purpose: the Atbash judge sees the first 240
// chars of the command line, so `bsc-defi health protect --min-hf 1.5
// --execute` must read as what it is from the left.
//
// Output: one JSON object/array on stdout; errors {"error": …} + exit 1.

import { parseArgv, output, fail, CliError } from '../src/util.mjs';
import { cmdWallet } from '../src/wallet.mjs';
import { cmdDoctor } from '../src/doctor.mjs';
import { cmdPositions } from '../src/positions.mjs';
import { cmdSwap } from '../src/swap.mjs';
import { cmdLpAdd, cmdLpRemove, cmdLpRebalance } from '../src/lp.mjs';
import { cmdGridInit, cmdGridRun, cmdGridStatus } from '../src/grid.mjs';
import { cmdYieldScan, cmdYieldMove } from '../src/yield.mjs';
import { cmdHealthCheck, cmdHealthProtect } from '../src/health.mjs';
import { cmdHelp } from '../src/help.mjs';

function sub(words, allowed) {
  const s = words[1];
  if (!s || !allowed.includes(s)) {
    throw new CliError(`usage: bsc-defi ${words[0]} <${allowed.join('|')}> …`);
  }
  return s;
}

async function main() {
  const { words, flags } = parseArgv(process.argv.slice(2));
  const cmd = words[0];

  switch (cmd) {
    case undefined:
    case 'help':
      return output(cmdHelp(words.slice(1)));
    case 'wallet':
      return output(await cmdWallet(flags));
    case 'doctor': {
      const report = await cmdDoctor();
      output(report);
      process.exit(report.ok ? 0 : 1);
      return undefined;
    }
    case 'positions':
      return output(await cmdPositions(flags));
    case 'swap':
      return output(await cmdSwap(flags));
    case 'lp':
      switch (sub(words, ['add', 'remove', 'rebalance'])) {
        case 'add': return output(await cmdLpAdd(flags));
        case 'remove': return output(await cmdLpRemove(flags));
        default: return output(await cmdLpRebalance(flags));
      }
    case 'grid':
      switch (sub(words, ['init', 'run', 'status'])) {
        case 'init': return output(await cmdGridInit(flags));
        case 'run': return output(await cmdGridRun(flags));
        default: return output(await cmdGridStatus(flags));
      }
    case 'yield':
      switch (sub(words, ['scan', 'move'])) {
        case 'scan': return output(await cmdYieldScan(flags));
        default: return output(await cmdYieldMove(flags));
      }
    case 'health':
      switch (sub(words, ['check', 'protect'])) {
        case 'check': return output(await cmdHealthCheck(flags));
        default: return output(await cmdHealthProtect(flags));
      }
    default:
      throw new CliError(`unknown command "${cmd}" — run bsc-defi help`);
  }
}

main().catch((e) => {
  fail(e instanceof CliError ? e.message : e.shortMessage || e.message || String(e));
});
