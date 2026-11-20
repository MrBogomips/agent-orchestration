export declare const T0: number
export declare const SESSION: string
export declare const PROJECT: { id: string; root: string }
export declare const GRID: { classes: { name: string; covers: string; neverBelowGrid: boolean; default: { tier: string; effort: string } }[] }
export declare const LIVE: { id: string; model: string; usage: Record<string, unknown>[]; cost: { usd: number } }[]
export declare const STATUS: { routing: boolean; routeSubagents: boolean; measuring: boolean; adapt: boolean }
export declare function outcomes(): Record<string, unknown>[]
export declare function events(): Record<string, unknown>[]
export declare function level(list: readonly Record<string, unknown>[], kind: string, project?: { id: string; root: string }): Record<string, unknown>
export declare function usageData(): { [key: string]: unknown }
