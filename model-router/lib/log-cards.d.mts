import type { Chip, Picture } from './usage-cards.mjs'

export type RecordLine = { when: string; type: string; session: string; lead: Chip | null; detail: string }
export type LogView = {
  subtitle: string
  files: { log: string; archive: string }
  windows: { window: string; isActive: boolean }[]
  types: { type: string; count: string; isActive: boolean; bar: Picture }[]
  chartTitle: string
  chart: { title: string; first: string; last: string; picture: Picture } | null
  rows: RecordLine[]
  paging: { label: string; hasNewer: boolean; hasOlder: boolean }
  empty: string | null
  read: string
}

export declare const LOG_PANE: string
export declare const LOG_PANE_TITLE: string
export declare const FILE_KEY: string
export declare const FILE_LABEL: string
export declare const ALL_TYPES: string
export declare function chartTitle(unit: unknown): string
export declare function fmtBytes(bytes: unknown): string
export declare function recordLine(record: unknown): RecordLine
export declare function logView(data: { [key: string]: any }): LogView
