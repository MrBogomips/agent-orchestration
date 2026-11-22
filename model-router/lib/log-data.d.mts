export type LogQuery = { window: string; type: string; page: number }
export type LogRecord = { ts: string | null; type: string; session: string | null; [field: string]: string | number | null }
export type LogResult = {
  query: LogQuery
  pageSize: number
  pages: number
  total: number
  matched: number
  isCut: boolean
  byType: { type: string; n: number }[]
  series: { unit: 'hour' | 'day'; points: { key: string; n: number }[] }
  records: LogRecord[]
}

export declare const LOG_WINDOWS: Readonly<Record<string, number | null>>
export declare const DEFAULT_QUERY: Readonly<LogQuery>
export declare const PAGE_SIZE: number
export declare const MAX_KEPT: number
export declare const DAYS_SHOWN: number
export declare const HOURS_SHOWN: number
export declare function queryOf(query: unknown): LogQuery
export declare function slimRecord(record: unknown): LogRecord
export declare function logCollector(input: { query: unknown; now: number; pageSize?: number }): { add(record: unknown): void; result(): LogResult }
