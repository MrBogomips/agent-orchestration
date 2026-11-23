import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOWS, isArrowScroll, padRows, ringTarget, stepWindow, tabKey, tabOfKey, windowKey, windowOfKey } from './usage-nav.mjs';

test('the windows are drawn shortest first', () => {
  assert.deepEqual(WINDOWS, ['24h', '7d', '30d', 'all']);
});

test('keys name a tab or a window and are read back', () => {
  assert.equal(tabKey('models'), 'tab-models');
  assert.equal(windowKey('30d'), 'window-30d');
  assert.equal(tabOfKey('tab-decisions'), 'decisions');
  assert.equal(tabOfKey('tab-nope'), null);
  assert.equal(tabOfKey('window-7d'), null);
  assert.equal(tabOfKey(undefined), null);
  assert.equal(windowOfKey('window-all'), 'all');
  assert.equal(windowOfKey('window-1y'), null);
  assert.equal(windowOfKey('level'), null);
});

test('Down steps to the next window and Up to the one before, cycling', () => {
  assert.equal(stepWindow('7d', 1), '30d');
  assert.equal(stepWindow('all', 1), '24h');
  assert.equal(stepWindow('24h', -1), 'all');
  assert.equal(stepWindow('30d', -1), '7d');
  assert.equal(stepWindow('nonsense', 1), '30d');
});

test('a ring move onto a tab lands there', () => {
  assert.equal(ringTarget('tab-overview', 'tab-models'), 'tab-models');
  assert.equal(ringTarget('tab-classes', 'tab-models'), 'tab-models');
  assert.equal(ringTarget(null, 'tab-classes'), 'tab-classes');
});

test('Tab off the last tab wraps to the first, Shift+Tab off the first to the last', () => {
  assert.equal(ringTarget('tab-savings', 'window-24h'), 'tab-overview');
  assert.equal(ringTarget('tab-overview', 'title'), 'tab-savings');
  assert.equal(ringTarget('tab-overview', 'refresh'), 'tab-savings');
  assert.equal(ringTarget('tab-decisions', 'tab-savings'), 'tab-savings');
});

test("a move onto one of the engine's stops cannot be rewritten and lands there", () => {
  assert.equal(ringTarget('tab-overview', undefined), undefined);
});

test('a move off the row from a middle tab, or from outside it, lands where the engine put it', () => {
  assert.equal(ringTarget('tab-models', 'window-30d'), 'window-30d');
  assert.equal(ringTarget('window-30d', 'window-all'), 'window-all');
  assert.equal(ringTarget(null, undefined), undefined);
});

test('an arrow is a one-row scroll by the person with no pointer', () => {
  assert.equal(isArrowScroll({ by: 1, origin: { kind: 'person' } }), true);
  assert.equal(isArrowScroll({ by: -1, origin: { kind: 'person' } }), true);
  assert.equal(isArrowScroll({ by: 1, origin: { kind: 'person' }, pointer: { row: 2, column: 4 } }), false);
  assert.equal(isArrowScroll({ by: 12, origin: { kind: 'person' } }), false);
  assert.equal(isArrowScroll({ by: 1, origin: { kind: 'plugin', name: 'x' } }), false);
  assert.equal(isArrowScroll(undefined), false);
});

test('the body is padded to one row more than the window', () => {
  assert.equal(padRows(10, 20), 11);
  assert.equal(padRows(21, 20), 0);
  assert.equal(padRows(20, 20), 1);
  assert.equal(padRows(5, undefined), 0);
  assert.equal(padRows(5, 0), 0);
});
