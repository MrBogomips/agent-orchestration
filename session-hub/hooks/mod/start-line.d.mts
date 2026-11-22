import type { Segment } from './look.mjs'

export type ChildStart = { name: string; model?: string; effort?: string }

export function childStarts(command: string): ChildStart[]

export function startLineSegments(start: ChildStart): Segment[]

export function startLineText(start: ChildStart): string

export function isSessionStartTool(tool: unknown): boolean

export function toolStarts(tool: string, input: unknown): ChildStart[]
