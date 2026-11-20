export declare function words(text: unknown): string[]
export declare function jaccard(a: readonly string[], b: readonly string[]): number
export declare function isSimilar(a: string, b: string, threshold: number): boolean
export declare function parseTag(description: unknown, classes?: readonly string[]): { cls: string | null; risky: boolean }
export declare function mentionsFile(text: unknown, files: readonly string[]): boolean
