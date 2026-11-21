import type { Segment } from './look.mjs'

export type PanelRow = {
  name: string
  status: string
  live: string
  model: string
  effort: string
  last: string
}

export function liveStatuses(output: unknown): Map<string, string> | undefined

export function panelRows(record: { children?: unknown[] } | undefined, live?: Map<string, string>): PanelRow[]

export function formatRow(row: PanelRow, width: number): Segment[]

export function rowText(segments: Segment[]): string

export function headerRow(width: number): string

export function parseRegistryCall(command: string | undefined): { file?: string; hub?: string } | undefined
