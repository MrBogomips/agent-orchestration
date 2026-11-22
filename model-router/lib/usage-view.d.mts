export type Tone = 'title' | 'dim' | 'warn' | 'accent' | 'good' | 'fair' | 'bad'
export type Segment = { text: string; tone?: Tone | null }
export type Row = { text: string; tone?: Tone; segments?: Segment[] }
export type View = { tab?: string | null; window?: string | null; level?: string | null; status?: Record<string, unknown> }
export type Parsed =
  | { kind: 'toggle'; on: boolean }
  | { kind: 'help' }
  | { kind: 'report' }
  | { kind: 'view'; tab: string | null; window: string | null; level: string | null }
  | { kind: 'unknown'; word: string }

export declare const TABS: readonly string[]
export declare const TAB_TITLES: Readonly<Record<string, string>>
export declare const WINDOW_KEYS: Readonly<Record<string, string>>
export declare const WINDOW_TITLES: Readonly<Record<string, string>>
export declare const LEVELS: readonly string[]
export declare const DEFAULT_VIEW: Readonly<{ tab: string; window: string; level: string }>
export declare const MIN_COLUMNS: number
export declare const HEADLESS_COLUMNS: number
export declare function parseArgs(text: unknown): Parsed
export declare function helpText(): string
export declare function fmtTokens(n: unknown): string
export declare function fmtUsd(v: unknown): string
export declare function fmtPct(v: unknown): string
export declare function fmtNum(v: unknown): string
export declare function bar(share: unknown, width: number): string
export declare function fit(text: unknown, width: number): string
export declare function layoutWidth(columns: unknown): number
export declare function tabRows(data: unknown, view: View, columns: unknown): Row[]
export declare function noteRows(data: unknown, columns: unknown): Row[]
export declare function textView(data: unknown, view: View, columns: unknown): string
export declare const ACTION_ORDER: readonly string[]
export declare const DECISIONS_SHOWN: number
export declare const RECOMMENDATIONS_SHOWN: number
export declare function cellName(tier: unknown, effort: unknown): string
export declare function headlineFor(data: unknown, view: View): Record<string, any> | null
export declare function levelName(data: unknown, view: View): string
export declare function shortModel(model: unknown): string
