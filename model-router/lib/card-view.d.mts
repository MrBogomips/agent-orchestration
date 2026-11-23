export type Option = { value: string; label: string }
export declare const CARD_TITLE: string
export declare const VIEWS: readonly Option[]
export declare const SCOPES: readonly Option[]
export declare const WINDOWS: readonly Option[]
export declare const DEFAULT_CARD: Readonly<{ view: string; window: string; level: string; group: string | null; isCollapsed: boolean }>
export declare const REPORT_VIEWS: readonly string[]
export declare const ROWS_SHOWN: number
export declare const DECISIONS_SHOWN: number
export declare const RECORDS_SHOWN: number
export declare const WEEKS_SHOWN: number
export declare const ACTIONS: readonly { action: string; name: string; color: string }[]
export declare function cellName(tier: unknown, effort: unknown): string
export declare function cardStateOf(state: unknown): { view: string; window: string; level: string; group: string | null; isCollapsed: boolean }
export declare function familiesOf(rows: unknown): { tier: string; n: number; success: number; cost: number; efforts: { effort: string | null; n: number; fpy: number | null }[] }[]
export declare function heatOf(daily: unknown, generatedAt: unknown): { source: string; alt: string; busiest: string } | null
export declare function changeText(headline: unknown, window: string): string | null
export declare function perDayChart(daily: unknown, window: string, generatedAt: unknown): { kind: 'chart'; title: string; source: string; alt: string } | null
export declare function cardOf(input: { state: unknown; usage?: unknown; report?: unknown; log?: unknown; status?: unknown }): any
export declare function helpCard(): any
