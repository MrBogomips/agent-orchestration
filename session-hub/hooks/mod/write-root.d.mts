export function checkRootSetting(raw: unknown): string

export function checkRootFolder(found: {
  raw: string
  real: string
  kind: 'dir' | 'other' | 'missing'
  home?: string
}): string
