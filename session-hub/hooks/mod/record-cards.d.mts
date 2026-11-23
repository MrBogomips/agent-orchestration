export type Chip = { text: string; tone: 'good' | 'fair' | 'bad' | 'accent' | 'dim' }
export type ChildCard = { name: string; status: Chip; reason: string | null; runs: string; where: string | null; started: string; last: string; requests: string }
export type TimelineRow = { when: string | null; child: string; what: Chip; text: string }
export type RecordView = { subtitle: string; file: string; children: ChildCard[]; timeline: TimelineRow[]; more: string | null; total: number; empty: string | null }

export declare const TIMELINE_SHOWN: number
export declare function recordView(record: unknown, options?: { file?: string }): RecordView
