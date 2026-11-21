import type { Role } from './role.mjs'

type Master = { record?: string; hub?: string }
type Mismatch = { own: string; master: string }

export const SECTION_ID: string

export function scopeSection(input: { role: Role; master?: Master; mismatch?: Mismatch }):
  | { id: string; text: string; scope: 'session' }
  | undefined

export function roleSummary(input: { role: Role; master?: Master; mismatch?: Mismatch }): string[]
