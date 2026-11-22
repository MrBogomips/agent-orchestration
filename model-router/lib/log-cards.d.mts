import type { Chip } from './usage-cards.mjs'

export type RecordLine = { when: string; type: string; session: string; lead: Chip | null; detail: string }

export declare function fmtBytes(bytes: unknown): string
export declare function recordLine(record: unknown): RecordLine
