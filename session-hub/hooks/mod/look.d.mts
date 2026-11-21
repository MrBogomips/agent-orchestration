export type Segment = { text: string; color?: string; bold?: true; tone?: 'dim' | 'good' | 'fair' | 'bad' }

export const ROUTE_ICON: string
export const ARROW: string
export const CELL_FULL: string
export const CELL_EMPTY: string
export const MODEL_COLORS: Readonly<Record<'haiku' | 'sonnet' | 'opus' | 'fable', string>>
export const EFFORT_COLORS: Readonly<Record<'low' | 'medium' | 'high' | 'xhigh', string>>
export const EMPTY_COLOR: string
export const MODEL_WIDTH: number
export const EFFORT_WIDTH: number

export function modelParts(model: unknown): { name: string; color: string | null }

export function effortParts(effort: unknown, unknown?: string): { filled: string; empty: string; word: string; color: string | null }

export function modelEffortSegments(model: unknown, effort: unknown, options?: { pad?: boolean; unknown?: string }): Segment[]
