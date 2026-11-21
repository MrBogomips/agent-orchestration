import type { Role } from './role.mjs'

export function shellWriteTargets(command: string): string[]

export function normalizePath(path: string): string

export function judgeShell(input: {
  role: Role
  command: string
  cwd?: string
  home?: string
  realpath: (path: string) => Promise<string>
  fileKind: (path: string) => Promise<'dir' | 'other' | 'missing'>
}): Promise<{ allow: true; reason?: undefined } | { allow: false; reason: string }>
