export declare const CARD_WIDTH: number
export declare const ACCENT: string
export declare const SHADES: Readonly<Record<string, string>>
export declare const SHADE_ORDER: readonly string[]
export declare const KIND_COLORS: readonly string[]
export declare const TONE_COLORS: Readonly<Record<'good' | 'fair' | 'bad' | 'dim', string>>
export declare function escapeXml(text: unknown): string
export declare function barSvg(share: unknown, color?: string): string
export declare function segmentsSvg(parts: readonly { share: number; color?: string }[]): string
export declare function ruleSvg(): string
export declare function squareSvg(color: string): string
export declare function dotSvg(tone: string): string
export declare function chevronSvg(isOpen: boolean): string
export declare function iconSvg(name: string): string
export declare function heatmapSvg(input: { weeks: (number | null)[][]; months?: { week: number; label: string }[]; less?: string; more?: string }): string
export declare function chartSvg(input: { bars: { label: string; parts: { value: number; color?: string }[] }[]; ticks?: { value: number; label: string }[]; max: number }): string
export declare function scaleOf(max: number, fmt?: (v: number) => string): { top: number; ticks: { value: number; label: string }[] }
export declare function stampOf(seq: number, at: number): string
export declare function cardIdOf(text: unknown): { seq: number; read: string } | null
export declare function textOf(card: unknown): string
