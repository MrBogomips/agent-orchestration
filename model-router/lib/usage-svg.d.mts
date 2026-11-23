export type SvgOptions = { width?: number; height?: number; color?: string }

export declare const SVG_MAX: number
export declare const COLORS: Readonly<{ accent: string; line: string; good: string; fair: string; bad: string; dim: string }>
export declare function escapeXml(text: unknown): string
export declare function toneColor(tone: unknown): string
export declare function sparklineSvg(values: unknown, options?: SvgOptions & { domain?: readonly [number, number]; labels?: readonly string[] }): string
export declare function barSvg(share: unknown, options?: SvgOptions): string
export declare const SPARK_SIZE: Readonly<{ width: number; height: number }>
export declare const BAR_SIZE: Readonly<{ width: number; height: number }>
export declare const COLUMNS_SIZE: Readonly<{ width: number; height: number }>
export declare function partsBarSvg(parts: unknown, options?: { width?: number; height?: number }): string
export declare const PAIRS_SIZE: Readonly<{ width: number; height: number }>
export declare function pairedBarsSvg(pairs: unknown, options?: SvgOptions & { labels?: readonly (readonly string[])[] }): string
export declare function columnsSvg(values: unknown, options?: SvgOptions & { labels?: readonly string[] }): string
