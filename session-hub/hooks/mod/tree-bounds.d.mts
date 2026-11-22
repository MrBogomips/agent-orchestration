export type TreeSize = { nodes: number; depth: number; chars: number }

export declare const TREE_BOUNDS: Readonly<TreeSize>
export declare const TREE_BUDGET: Readonly<TreeSize>
export declare function treeSize(tree: unknown): TreeSize
export declare function fitsBudget(size: TreeSize, budget?: TreeSize): boolean
export declare function overBudget(size: TreeSize, budget?: TreeSize): string
export declare function firstThatFits<T>(
  builders: readonly (() => T)[],
  options?: { budget?: TreeSize; onSkip?: (index: number, reason: string) => void },
): { tree: T | null; index: number; size: TreeSize }
