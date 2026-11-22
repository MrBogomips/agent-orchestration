import type { CardsView, Chip, Picture } from './usage-cards.mjs'

export type TrendChart = { title: string; latest: string; picture: Picture; first: string; last: string }
export type TrendSection = { title: string; empty: string | null; charts: TrendChart[]; rows: { week: string; tasks: string; fpy: string; costPerSuccess: string }[] }
export type ReportDecisions = { title: string; summary: string; empty: string | null; chips: Chip[]; note: string }
export type CellRow = {
  mark: 'recommended' | 'few' | null
  isFew: boolean
  name: string
  tasks: string
  weighted: string
  bar: Picture
  fpy: string
  rework: string
  costPerTask: string
  costPerSuccess: string
  explored: string
}
export type ClassCard = { name: string; covers: string; caption: string; differs: boolean; notes: string[]; empty: string | null; rows: CellRow[] }
export type LevelSection = { empty: string | null; cards: ClassCard[] }
export type ReportView = {
  generated: string
  headline: CardsView | null
  trend: TrendSection
  decisions: ReportDecisions
  classes: LevelSection & { title: string; caption: string }
  projects: { title: string; note: string | null; sections: (LevelSection & { title: string })[] } | null
  footnotes: string[]
  source: string
  privacy: string
}

export declare const REPORT_WINDOW: string
export declare const MARKS: Readonly<{ recommended: string; few: string }>
export declare const TREND_SIZE: Readonly<{ width: number; height: number }>
export declare function readableTime(iso: unknown): string
export declare function taskCount(cell: { tasks?: number; n?: number }): number
export declare function reportView(data: { [key: string]: unknown }): ReportView
