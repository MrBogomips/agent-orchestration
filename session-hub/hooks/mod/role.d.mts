export type Role = Readonly<{
  kind: 'none' | 'child' | 'invalid'
  guarding: boolean
  guardsOff: boolean
  master?: string
  scopeRoot?: string
  handoff?: string
  registry?: string
  raw?: string
}>

export function readRole(values: {
  role?: string
  master?: string
  scopeRoot?: string
  handoff?: string
  registry?: string
  guards?: string
}): Role
