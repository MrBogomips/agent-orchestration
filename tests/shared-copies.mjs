// Checks that the modules each plugin keeps its own copy of behave alike in both: the host rule (model-router's
// lib/open-report.mjs and session-hub's hooks/mod/host.mjs) and the bounds of a tree (lib/tree-bounds.mjs and
// hooks/mod/tree-bounds.mjs), compared by what they answer; and the card of the desktop app (hooks/card-kit.tsx,
// and lib/card-parts.mjs against hooks/mod/card-parts.mjs), which must be the same text. A plugin uses nothing
// outside its folder, hence the copies.
// Usage: node tests/shared-copies.mjs [repo-root]   Exits 1 and names each answer that differs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
const load = (path) => import(pathToFileURL(resolve(root, path)).href);
const differences = [];
const same = (what, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) differences.push(`${what}: model-router ${JSON.stringify(a)}, session-hub ${JSON.stringify(b)}`);
};

// The host rule: every combination of attached surfaces and entry points.
const hostMr = await load('model-router/lib/open-report.mjs');
const hostSh = await load('session-hub/hooks/mod/host.mjs');
const SURFACES = [undefined, null, 'desktop', [], ['terminal'], ['desktop'], ['vscode'], ['mobile'], ['terminal', 'desktop'], ['mobile', 'terminal'], ['other'], ['']];
const ENTRYPOINTS = [undefined, null, '', ' ', 'cli', 'CLI', ' cli ', 'sdk-cli', 'sdk-ts', 'SDK-PY', 'sdk', 'claude-desktop', 'claude-vscode', 'remote', 'anything', 7];
for (const surfaces of SURFACES) {
  for (const entrypoint of ENTRYPOINTS) {
    same(`hostKind(${JSON.stringify({ surfaces, entrypoint })})`, hostMr.hostKind({ surfaces, entrypoint }), hostSh.hostKind({ surfaces, entrypoint }));
  }
}
same('hostKind()', hostMr.hostKind(), hostSh.hostKind());
for (const surface of ['terminal', 'desktop', 'vscode', 'mobile', '', null, undefined, 3]) {
  same(`isGraphical(${JSON.stringify(surface)})`, hostMr.isGraphical(surface), hostSh.isGraphical(surface));
}

// The bounds of a tree: the constants, and the measure of a few trees.
const treeMr = await load('model-router/lib/tree-bounds.mjs');
const treeSh = await load('session-hub/hooks/mod/tree-bounds.mjs');
same('TREE_BOUNDS', treeMr.TREE_BOUNDS, treeSh.TREE_BOUNDS);
same('TREE_BUDGET', treeMr.TREE_BUDGET, treeSh.TREE_BUDGET);
const el = (type, props = {}, ...children) => ({ type, props, children });
const loop = el('Box');
loop.children.push(loop);
const TREES = [
  null, undefined, 'text', 7, [], el('Text', {}, 'x'), el('Box', { gap: 'md', onPress: () => 1 }, el('Text', {}, 'a'), [el('Text', {}, 'b'), el('Box', {}, el('Svg', { source: '<svg/>' }))]),
  el('Text', {}, 'x'.repeat(90000)), Array.from({ length: 17000 }, () => el('Text')), loop,
];
for (const [i, tree] of TREES.entries()) {
  const [a, b] = [treeMr.treeSize(tree), treeSh.treeSize(tree)];
  same(`treeSize(tree ${i})`, [a.nodes, a.depth, a.chars].map(String), [b.nodes, b.depth, b.chars].map(String));
  same(`fitsBudget(tree ${i})`, treeMr.fitsBudget(a), treeSh.fitsBudget(b));
  same(`overBudget(tree ${i})`, treeMr.overBudget(a), treeSh.overBudget(b));
}
const pick = (mod) => {
  const skipped = [];
  const found = mod.firstThatFits([() => TREES[7], () => { throw new Error('no') }, () => TREES[5]], { onSkip: (i, why) => skipped.push([i, why]) });
  return [found.index, found.size, skipped];
};
same('firstThatFits', pick(treeMr), pick(treeSh));
same('firstThatFits(none)', treeMr.firstThatFits([() => TREES[7]]).index, treeSh.firstThatFits([() => TREES[7]]).index);

// The card: the same text in both plugins.
for (const [mr, sh] of [['model-router/hooks/card-kit.tsx', 'session-hub/hooks/card-kit.tsx'], ['model-router/lib/card-parts.mjs', 'session-hub/hooks/mod/card-parts.mjs'], ['model-router/lib/card-parts.d.mts', 'session-hub/hooks/mod/card-parts.d.mts']]) {
  const text = (path) => {
    try {
      return readFileSync(resolve(root, path), 'utf8');
    } catch (error) {
      return `unreadable: ${error.code ?? error.message}`;
    }
  };
  if (text(mr) !== text(sh)) differences.push(`${mr} and ${sh} differ: change both in the same pull request`);
}

if (differences.length > 0) {
  for (const line of differences) console.error(line);
  process.exit(1);
}
