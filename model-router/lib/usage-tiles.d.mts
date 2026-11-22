import type { Row, Segment, Tone } from './usage-view.mjs'

export type Status = { dot: string; word: string; tone: Tone }

export declare const WEAK_N: number
export declare const TILES_ONE_ROW: number
export declare function cols(text: string): number
export declare function sparkline(values: readonly unknown[]): string
export declare function fpyStatus(fpy: unknown, n: number): Status
export declare function reworkStatus(rate: unknown, n: number): Status
export declare function costStatus(now: unknown, before: unknown, n: number): Status
export declare function deltaOf(now: unknown, before: unknown, options: { points?: boolean; higherIsBetter: boolean }): { text: string; tone: Tone | null }
export declare function tilesOf(headline: unknown): Segment[][][]
export declare function segRow(segments: Segment[]): Row
export declare function tileRows(headline: unknown, width: number): Row[]
export declare function sparkRows(series: unknown): Row[]
