export declare const BROWSER_SERVER: string
export declare const BROWSER_TOOL: string
export declare const PANE_SURFACE: string
export declare function fileUrl(path: unknown): string | null
export declare function hasBrowserPane(surfaces: unknown): boolean
export declare function connectRefusal(answer: unknown): string | null
export declare function paneRefusal(result: unknown): string | null
export declare function reportLine(how: 'pane' | 'browser' | 'none', file: string, why?: unknown): string
