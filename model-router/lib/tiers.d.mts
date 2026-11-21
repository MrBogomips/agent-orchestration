export declare const PRICE_ORDER: readonly string[]
export declare const EFFORT_LEVELS: readonly string[]
export declare function familyOf(model: unknown): string
export declare function tierRank(model: unknown): number
export declare function effortOf(value: unknown): string | null
export declare function effortRank(level: unknown): number
export declare function raiseEffort(level: string | null, floor: string): string
