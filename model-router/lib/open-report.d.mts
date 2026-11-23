export declare function isGraphical(surface: unknown): boolean
export declare function hostKind(input?: { surfaces?: unknown; entrypoint?: unknown }): 'terminal' | 'graphical' | 'headless'
export declare function reportLine(how: 'browser' | 'none', file?: string, why?: unknown): string
