export declare const WINDOWS: readonly string[]
export declare function tabKey(tab: string): string
export declare function windowKey(window: string): string
export declare function tabOfKey(key: unknown): string | null
export declare function windowOfKey(key: unknown): string | null
export declare function stepWindow(window: string, steps: number): string
export declare function ringTarget(from: string | null | undefined, to: string | undefined): string | undefined
export declare function isArrowScroll(e: unknown): boolean
export declare function padRows(drawn: number, bodyRows: unknown): number
