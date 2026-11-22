export declare const REPORT_PANE: string
export declare const REPORT_PANE_TITLE: string
export declare const PAGE_KEY: string
export declare const PAGE_LABEL: string
export declare const PAGE_HOTKEY: string
export declare function isGraphical(surface: unknown): boolean
export declare function hostKind(input?: { surfaces?: unknown; entrypoint?: unknown }): 'terminal' | 'graphical' | 'headless'
export declare function reportLine(how: 'pane' | 'browser' | 'none', file?: string, why?: unknown): string
