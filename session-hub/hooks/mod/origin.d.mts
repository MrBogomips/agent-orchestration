import type { Role } from './role.mjs'

export const ORIGIN_LINE: string

export function isFromAnotherSession(kind: string | undefined): boolean

export function markText(input: { role: Role; kind: string; text: string }): string

export function markContext(input: {
  role: Role
  kind: string
  text: string
  context?: readonly string[]
}): string[] | undefined
