import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, tierRank, effortOf, effortRank, raiseEffort, PRICE_ORDER, EFFORT_LEVELS } from './tiers.mjs';

test('familyOf maps aliases and full ids to the four families, anything else to other', () => {
  assert.equal(familyOf('haiku'), 'haiku');
  assert.equal(familyOf('claude-sonnet-5-5'), 'sonnet');
  assert.equal(familyOf('us.anthropic.claude-opus-5-5-v1:0'), 'opus');
  assert.equal(familyOf('claude-fable-5-5[1m]'), 'fable');
  assert.equal(familyOf('gpt-x'), 'other');
  assert.equal(familyOf(undefined), 'other');
});

test('tierRank follows the price order; other is unknown', () => {
  assert.deepEqual(PRICE_ORDER, ['haiku', 'sonnet', 'opus', 'fable']);
  assert.equal(tierRank('haiku'), 0);
  assert.equal(tierRank('claude-fable-5-5'), 3);
  assert.equal(tierRank('mystery'), -1);
});

test('effortOf maps names and numbers to a named level, never max', () => {
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh']);
  assert.equal(effortOf('high'), 'high');
  assert.equal(effortOf('max'), 'xhigh');
  assert.equal(effortOf(0), 'low');
  assert.equal(effortOf(2), 'high');
  assert.equal(effortOf(2.6), 'xhigh');
  assert.equal(effortOf(9), 'xhigh');
  assert.equal(effortOf(undefined), null);
  assert.equal(effortOf('loud'), null);
});

test('raiseEffort never lowers', () => {
  assert.equal(raiseEffort('low', 'high'), 'high');
  assert.equal(raiseEffort('xhigh', 'high'), 'xhigh');
  assert.equal(raiseEffort(null, 'high'), 'high');
  assert.equal(effortRank('medium'), 1);
});
