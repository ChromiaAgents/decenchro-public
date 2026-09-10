import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgv, requireFlag, requireAmount, toJson } from '../src/util.mjs';

// Plan snapshots: the exact parse of each command surface's argv. The verbs
// sit FIRST (the audit judge sees only the first 240 chars of the command
// line), flags follow.

test('swap argv', () => {
  assert.deepEqual(
    parseArgv(['swap', '--in', 'BNB', '--out', 'USDT', '--amount', '0.1', '--execute']),
    { words: ['swap'], flags: { in: 'BNB', out: 'USDT', amount: '0.1', execute: true } },
  );
});

test('health protect argv (verb + key params lead)', () => {
  assert.deepEqual(
    parseArgv(['health', 'protect', '--min-hf', '1.5', '--execute']),
    { words: ['health', 'protect'], flags: { 'min-hf': '1.5', execute: true } },
  );
});

test('lp add argv with a negative-leading range value', () => {
  assert.deepEqual(
    parseArgv(['lp', 'add', '--pair', 'WBNB/USDT', '--fee', '2500', '--range', '-5%..+5%', '--amount0', '0.1', '--amount1', '60']),
    {
      words: ['lp', 'add'],
      flags: { pair: 'WBNB/USDT', fee: '2500', range: '-5%..+5%', amount0: '0.1', amount1: '60' },
    },
  );
});

test('lp rebalance argv', () => {
  assert.deepEqual(
    parseArgv(['lp', 'rebalance', '--id', '4211', '--width', '10%']),
    { words: ['lp', 'rebalance'], flags: { id: '4211', width: '10%' } },
  );
});

test('grid init argv', () => {
  assert.deepEqual(
    parseArgv(['grid', 'init', '--pair', 'WBNB/USDT', '--lower', '500', '--upper', '700', '--levels', '11', '--size', '0.01']),
    {
      words: ['grid', 'init'],
      flags: { pair: 'WBNB/USDT', lower: '500', upper: '700', levels: '11', size: '0.01' },
    },
  );
});

test('yield scan with reference', () => {
  assert.deepEqual(
    parseArgv(['yield', 'scan', '--reference', 'mainnet']),
    { words: ['yield', 'scan'], flags: { reference: 'mainnet' } },
  );
});

test('boolean flag before another flag stays boolean', () => {
  assert.deepEqual(
    parseArgv(['grid', 'run', '--execute', '--pair', 'WBNB/USDT']),
    { words: ['grid', 'run'], flags: { execute: true, pair: 'WBNB/USDT' } },
  );
});

test('bare words collect as verbs', () => {
  assert.deepEqual(parseArgv(['help', 'lp', 'add']), { words: ['help', 'lp', 'add'], flags: {} });
});

test('requireFlag throws a named error', () => {
  assert.throws(() => requireFlag({}, 'pair'), /missing --pair/);
  assert.throws(() => requireFlag({ pair: true }, 'pair'), /missing --pair/); // boolean, no value
  assert.equal(requireFlag({ pair: 'A/B' }, 'pair'), 'A/B');
});

test('requireAmount rejects zero/negative/NaN', () => {
  assert.throws(() => requireAmount({ amount: '0' }, 'amount'), /positive/);
  assert.throws(() => requireAmount({ amount: '-1' }, 'amount'), /positive/);
  assert.throws(() => requireAmount({ amount: 'abc' }, 'amount'), /positive/);
  assert.equal(requireAmount({ amount: '0.5' }, 'amount'), '0.5');
});

test('toJson serializes BigInt as decimal strings', () => {
  assert.equal(toJson({ wei: 10n ** 18n }), '{\n  "wei": "1000000000000000000"\n}');
});
