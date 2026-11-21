export type IdentityMismatch = Readonly<{ own: string; master: string }>
export function masterConfigDir(registry: unknown): string | undefined
export function ownConfigDir(given: { configDir?: string; home?: string }): string | undefined
export function identityMismatch(given: {
  role: { kind: string; registry?: string }
  configDir?: string
  home?: string
  realpath?: (path: string) => Promise<string> | string
}): Promise<IdentityMismatch | undefined>
export function mismatchText(mismatch: { own: string; master: string }): string
