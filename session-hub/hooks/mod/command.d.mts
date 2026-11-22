export declare function parseCommand(args: unknown): { kind: 'show' } | { kind: 'log' } | { kind: 'help' } | { kind: 'unknown'; word: string }
export declare function helpText(): string
