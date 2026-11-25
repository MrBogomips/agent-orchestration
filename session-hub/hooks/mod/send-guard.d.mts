import type { Role } from './role.mjs'

export function recipientName(to: string | undefined): string

export function recipientRef(to: string | undefined): string | undefined

export function liveMaster(
  role: Role,
  live: ReadonlyArray<{ name?: string; ref?: string }> | undefined,
): { name: string; ref: string } | undefined

export function judgeSend(input: {
  role: Role
  to?: string
  agentId?: string
  agents?: ReadonlyArray<{ id: string; name?: string }>
  live?: ReadonlyArray<{ name?: string; ref?: string }>
}):
  | { deliver: true; toMaster?: undefined; reason?: undefined }
  | { deliver: true; toMaster: true; to: string; sessionId?: string; reason?: undefined }
  | { deliver: false; reason: string }
