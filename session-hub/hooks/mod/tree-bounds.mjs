// The bounds every tree a hook returns must keep, and a measure of a tree against them. Claude Code refuses a tree
// past them, and a refused tree leaves the pane with the app's own empty state ("Nothing to show yet"), with no
// error the person sees: a rendering measures its tree and draws a smaller one instead.
// See docs/design/ui-design.md, "The size of a tree". The same module as model-router's lib/tree-bounds.mjs: each plugin
// keeps its own copy, and tests/shared-copies.mjs checks that the two behave alike.
// Plain ES module with no Node or engine imports, so the mod and node tests load it.

/** The engine's bounds for a tree: nodes, depth and characters once serialized (Claude Code 2.1.330). */
export const TREE_BOUNDS = Object.freeze({ nodes: 20000, depth: 32, chars: 100000 });
/**
 * What a rendering allows itself: four fifths of the characters and the nodes, since the engine serializes a tree
 * its own way (handlers, keys) and a measure here can only come close; the depth as it is.
 */
export const TREE_BUDGET = Object.freeze({ nodes: 16000, depth: TREE_BOUNDS.depth, chars: 80000 });

/**
 * The size of a tree: its elements (objects with a `type`), how deep they nest, and its characters as JSON
 * (handlers are functions and count for nothing). A tree that cannot be serialized (a cycle) is infinitely large.
 */
export function treeSize(tree) {
  let nodes = 0;
  let depth = 0;
  const seen = new Set();
  const walk = (value, level) => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) throw new Error('cycle');
    seen.add(value);
    const isElement = !Array.isArray(value) && 'type' in value;
    const here = isElement ? level + 1 : level;
    if (isElement) {
      nodes += 1;
      depth = Math.max(depth, here);
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, here);
    seen.delete(value);
  };
  try {
    walk(tree, 0);
    return { nodes, depth, chars: (JSON.stringify(tree) ?? '').length };
  } catch {
    return { nodes: Infinity, depth: Infinity, chars: Infinity };
  }
}

/** Whether a size is within a budget (TREE_BUDGET by default) on every count. */
export function fitsBudget(size, budget = TREE_BUDGET) {
  return size.nodes <= budget.nodes && size.depth <= budget.depth && size.chars <= budget.chars;
}

/** What is over the budget, for one line of a log: `chars 149964 > 80000`. */
export function overBudget(size, budget = TREE_BUDGET) {
  return ['chars', 'nodes', 'depth'].filter((k) => size[k] > budget[k]).map((k) => `${k} ${size[k]} > ${budget[k]}`).join(', ');
}

/**
 * The first of `builders` (functions that each return a tree, richest first) whose tree fits the budget:
 * `{ tree, index, size }`. With none, `{ tree: null, index: -1, size }` of the last one tried. A builder that
 * throws is passed over; `onSkip(index, reason)` hears why each one was not taken.
 */
export function firstThatFits(builders, { budget = TREE_BUDGET, onSkip = () => {} } = {}) {
  let size = { nodes: 0, depth: 0, chars: 0 };
  for (const [index, build] of builders.entries()) {
    try {
      const tree = build();
      size = treeSize(tree);
      if (fitsBudget(size, budget)) return { tree, index, size };
      onSkip(index, overBudget(size, budget));
    } catch (err) {
      onSkip(index, String(err?.message ?? err).slice(0, 200));
    }
  }
  return { tree: null, index: -1, size };
}
