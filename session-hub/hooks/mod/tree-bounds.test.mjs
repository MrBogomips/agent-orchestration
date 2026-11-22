import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TREE_BOUNDS, TREE_BUDGET, firstThatFits, fitsBudget, overBudget, treeSize } from './tree-bounds.mjs';

const el = (type, props = {}, ...children) => ({ type, props, children });

test('the budget is inside the engine\'s bounds', () => {
  assert.deepEqual(TREE_BOUNDS, { nodes: 20000, depth: 32, chars: 100000 });
  assert.ok(TREE_BUDGET.chars < TREE_BOUNDS.chars && TREE_BUDGET.nodes < TREE_BOUNDS.nodes && TREE_BUDGET.depth <= TREE_BOUNDS.depth);
});

test('a tree is measured in elements, depth and serialized characters; handlers count for nothing', () => {
  const tree = el('Box', { gap: 'md' }, el('Text', {}, 'hello'), [el('Button', { label: 'go', onPress: () => 1 }), el('Box', {}, el('Text', {}, 'deep'))]);
  const size = treeSize(tree);
  assert.deepEqual([size.nodes, size.depth], [5, 3]);
  assert.equal(size.chars, JSON.stringify(tree).length);
  assert.ok(!JSON.stringify(tree).includes('onPress'));
  assert.deepEqual(treeSize('text'), { nodes: 0, depth: 0, chars: 6 });
  assert.deepEqual(treeSize(null), { nodes: 0, depth: 0, chars: 4 });
  assert.deepEqual(treeSize(undefined), { nodes: 0, depth: 0, chars: 0 });
});

test('an element held in a prop counts too, and the same element drawn twice is two', () => {
  const chip = el('Text', {}, 'x');
  assert.equal(treeSize(el('Box', { header: chip }, chip, chip)).nodes, 4);
});

test('a tree that cannot be serialized is infinitely large', () => {
  const loop = el('Box');
  loop.children.push(loop);
  assert.deepEqual(treeSize(loop), { nodes: Infinity, depth: Infinity, chars: Infinity });
  assert.equal(fitsBudget(treeSize(loop)), false);
});

test('a size fits when every count does; what is over is named', () => {
  assert.equal(fitsBudget({ nodes: 10, depth: 3, chars: 500 }), true);
  assert.equal(fitsBudget({ nodes: 10, depth: 3, chars: TREE_BUDGET.chars + 1 }), false);
  assert.equal(fitsBudget({ nodes: 10, depth: 33, chars: 5 }), false);
  assert.equal(overBudget({ nodes: 10, depth: 3, chars: 149964 }), 'chars 149964 > 80000');
  assert.equal(overBudget({ nodes: 30000, depth: 40, chars: 1 }), 'nodes 30000 > 16000, depth 40 > 32');
  assert.equal(overBudget({ nodes: 1, depth: 1, chars: 1 }), '');
});

test('the richest tree that fits is taken; one that throws or is too large is passed over and said why', () => {
  const big = el('Text', {}, 'x'.repeat(300));
  const small = el('Text', {}, 'ok');
  const skipped = [];
  const budget = { nodes: 10, depth: 5, chars: 100 };
  const found = firstThatFits([() => big, () => { throw new Error('no data') }, () => small], { budget, onSkip: (i, why) => skipped.push([i, why]) });
  assert.equal(found.tree, small);
  assert.equal(found.index, 2);
  assert.deepEqual(skipped, [[0, `chars ${JSON.stringify(big).length} > 100`], [1, 'no data']]);
  assert.equal(firstThatFits([() => small]).index, 0);
  const none = firstThatFits([() => big, () => big], { budget });
  assert.deepEqual([none.tree, none.index, none.size.chars], [null, -1, JSON.stringify(big).length]);
  assert.deepEqual(firstThatFits([]), { tree: null, index: -1, size: { nodes: 0, depth: 0, chars: 0 } });
});
