export type OpenPlan = { target: string; argv: string[] | null; text: string }
export type RecordSource = { file: string; hub?: undefined; none?: undefined } | { hub: string; file?: undefined; none?: undefined } | { none: string; file?: undefined; hub?: undefined }

export declare const LOG_KEY: string
export declare const LOG_HOTKEY: string
export declare const LOG_LABEL: string
export declare function openerArgv(platform: unknown, path: unknown): string[] | null
export declare function recordSource(input: {
  role: { kind: 'none' | 'child' | 'invalid'; registry?: string }
  master?: { isMaster: boolean; record?: string; hub?: string }
  cwd: string
}): RecordSource
export declare function recordPlan(input: { file: string; exists: boolean; platform?: unknown; isHosted?: boolean }): OpenPlan
export declare function failText(plan: OpenPlan, reason: unknown): string
