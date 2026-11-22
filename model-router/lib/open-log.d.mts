export type OpenPlan = { target: string | null; argv: string[] | null; text: string }

export declare const LOG_KEY: string
export declare const LOG_HOTKEY: string
export declare const LOG_LABEL: string
export declare function logPaths(configDir: string): { log: string; archive: string }
export declare function openerArgv(platform: unknown, path: unknown, kind: 'file' | 'folder'): string[] | null
export declare function openPlan(input: { configDir: string; platform?: unknown; isHosted?: boolean; hasLog: boolean; hasArchive: boolean }): OpenPlan
export declare function failText(plan: OpenPlan, reason: unknown): string
