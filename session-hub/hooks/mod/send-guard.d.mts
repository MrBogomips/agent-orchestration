import type { Role } from './role.mjs'

export function recipientName(to: string | undefined): string

export function judgeSend(input: {
  role: Role
  to?: string
  agentId?: string
  agents?: ReadonlyArray<{ id: string; name?: string }>
}): { deliver: true; to?: string; reason?: undefined } | { deliver: false; reason: string }
