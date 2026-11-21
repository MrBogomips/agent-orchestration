import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_EMPTY, CELL_FULL, EFFORT_COLORS, EMPTY_COLOR, MODEL_COLORS, ROUTE_ICON, effortParts, modelParts,
} from './look.mjs';

test('the values are the shared look of docs/design/shared-contract.md', () => {
  assert.deepEqual(MODEL_COLORS, { haiku: '#ececec', sonnet: '#7dd3fc', opus: '#3b82f6', fable: '#fb923c' });
  assert.deepEqual(EFFORT_COLORS, { low: '#22c55e', medium: '#eab308', high: '#f97316', xhigh: '#ef4444' });
  assert.equal(EMPTY_COLOR, '#3a3f47');
  assert.equal(CELL_FULL, '▰');
  assert.equal(CELL_EMPTY, '▱');
  assert.equal(ROUTE_ICON, '🔀');
});

test('a model is drawn by its tier name in the tier colour; an unknown id as it is, in no colour', () => {
  assert.deepEqual(modelParts('opus'), { name: 'opus', color: '#3b82f6' });
  assert.deepEqual(modelParts('claude-sonnet-5-5'), { name: 'sonnet', color: '#7dd3fc' });
  assert.deepEqual(modelParts('haiku'), { name: 'haiku', color: '#ececec' });
  assert.deepEqual(modelParts('fable'), { name: 'fable', color: '#fb923c' });
  assert.deepEqual(modelParts('gpt-x'), { name: 'gpt-x', color: null });
  assert.deepEqual(modelParts(undefined), { name: '-', color: null });
});

test('an effort is four cells, filled by level, and the word in the level colour', () => {
  assert.deepEqual(effortParts('low'), { filled: '▰', empty: '▱▱▱', word: 'low', color: '#22c55e' });
  assert.deepEqual(effortParts('medium'), { filled: '▰▰', empty: '▱▱', word: 'medium', color: '#eab308' });
  assert.deepEqual(effortParts('high'), { filled: '▰▰▰', empty: '▱', word: 'high', color: '#f97316' });
  assert.deepEqual(effortParts('xhigh'), { filled: '▰▰▰▰', empty: '', word: 'xhigh', color: '#ef4444' });
  assert.deepEqual(effortParts('max'), { filled: '▰▰▰▰', empty: '', word: 'xhigh', color: '#ef4444' });
});

test('an unknown effort has four empty cells and keeps its word, with no colour', () => {
  assert.deepEqual(effortParts('-'), { filled: '', empty: '▱▱▱▱', word: '-', color: null });
  assert.deepEqual(effortParts(undefined, 'default'), { filled: '', empty: '▱▱▱▱', word: 'default', color: null });
});
