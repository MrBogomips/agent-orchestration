import type { View } from './usage-view.mjs'

export type ChipTone = 'good' | 'fair' | 'bad' | 'accent' | 'dim' | 'warn'
export type Chip = { text: string; tone: ChipTone | null }
export type Picture = { source: string; alt: string; width: number; height: number; isInteractive?: boolean }
export type Pill = { key: string; text: string; on: boolean }
export type Kpi = { key: string; label: string; value: string; unit: string | null; chip: Chip | null; delta: Chip | null; detail: string | null; spark: Picture | null }
export type ModelItem = { name: string; fpy: string; bar: Picture; costPerSuccess: string; tasks: string; n: string; tokens: string; cost: string }
export type ModelsSection = { title: string; empty: string | null; rows: ModelItem[]; ids: string | null }
export type SessionSection = { title: string; summary: string | null; empty: string | null; rows: { model: string; detail: string; cost: string }[]; note: string | null }
export type RoutingSection = { title: string; empty: string | null; rows: { action: string; tone: ChipTone; count: string; bar: Picture }[] }
export type ClassMetrics = { n: string; fpy: string; rework: string; costPerSuccess: string; bar: Picture }
export type ClassItem = ClassMetrics & { name: string; grid: string; best: string; differs: boolean; flags: string | null; cells: (ClassMetrics & { name: string; recommended: boolean })[] }
export type ClassesSection = { title: string; empty: string | null; rows: ClassItem[]; recommendations: string[]; callout: string | null }
export type DecisionItem = { when: string; action: string; tone: ChipTone; models: string; who: string; reason: string; isThisSession: boolean }
export type DecisionsSection = { title: string; empty: string | null; rows: DecisionItem[]; legend: string | null }
export type CardsView = {
  tab: string
  window: string
  level: string
  pills: Pill[]
  subtitle: string | null
  banner: string | null
  kpis: Kpi[]
  message: Chip | null
  notes: Chip[]
  models?: ModelsSection
  session?: SessionSection
  routing?: RoutingSection
  classes?: ClassesSection
  decisions?: DecisionsSection
}

export declare const ACTION_TONES: Readonly<Record<string, ChipTone>>
export declare function bannerOf(headline: unknown): string | null
export declare function kpiCards(headline: unknown, context?: { window?: string; generatedAt?: unknown }): Kpi[]
export declare function cardsView(data: unknown, view: View, state?: { error?: string; isLoading?: boolean }): CardsView
