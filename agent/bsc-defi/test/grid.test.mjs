import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridLevels, crossedLevels } from '../src/math.mjs';

test('gridLevels: even spacing, bounds inclusive', () => {
  assert.deepEqual(gridLevels(100, 200, 5), [100, 125, 150, 175, 200]);
  assert.deepEqual(gridLevels(1, 2, 2), [1, 2]);
});

test('gridLevels validates input', () => {
  assert.throws(() => gridLevels(200, 100, 5)); // inverted
  assert.throws(() => gridLevels(0, 100, 5)); // non-positive lower
  assert.throws(() => gridLevels(100, 200, 1)); // too few levels
  assert.throws(() => gridLevels(100, 200, 2.5)); // non-integer
});

const LEVELS = [100, 125, 150, 175, 200];

test('rising price sells at each crossed level, in order', () => {
  assert.deepEqual(crossedLevels(110, 180, LEVELS), [
    { price: 125, side: 'sell' },
    { price: 150, side: 'sell' },
    { price: 175, side: 'sell' },
  ]);
});

test('falling price buys at each crossed level, in order', () => {
  assert.deepEqual(crossedLevels(180, 110, LEVELS), [
    { price: 175, side: 'buy' },
    { price: 150, side: 'buy' },
    { price: 125, side: 'buy' },
  ]);
});

test('no movement → no trades (idempotent re-run)', () => {
  assert.deepEqual(crossedLevels(140, 140, LEVELS), []);
});

test('a level equal to the previous price does not re-trigger', () => {
  // last run ended exactly ON 150 (progressive lastPrice after a fill)
  assert.deepEqual(crossedLevels(150, 160, LEVELS), []);
  assert.deepEqual(crossedLevels(150, 180, LEVELS), [{ price: 175, side: 'sell' }]);
  assert.deepEqual(crossedLevels(150, 130, LEVELS), []);
  assert.deepEqual(crossedLevels(150, 120, LEVELS), [{ price: 125, side: 'buy' }]);
});

test('landing exactly on a level triggers it once', () => {
  assert.deepEqual(crossedLevels(140, 150, LEVELS), [{ price: 150, side: 'sell' }]);
  assert.deepEqual(crossedLevels(160, 150, LEVELS), [{ price: 150, side: 'buy' }]);
});

test('jump across the whole grid crosses everything', () => {
  assert.equal(crossedLevels(90, 210, LEVELS).length, 5);
  assert.equal(crossedLevels(210, 90, LEVELS).length, 5);
});

test('moves outside the band cross nothing', () => {
  assert.deepEqual(crossedLevels(210, 220, LEVELS), []);
  assert.deepEqual(crossedLevels(95, 90, LEVELS), []);
});
