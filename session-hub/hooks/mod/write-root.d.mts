export function isRootSettings(path: string, root: string): boolean

export function settingsReason(path: string): string

export function checkRootSetting(raw: unknown): string

export function checkRootFolder(found: {
  raw: string
  real: string
  kind: 'dir' | 'other' | 'missing'
  home?: string
}): string
