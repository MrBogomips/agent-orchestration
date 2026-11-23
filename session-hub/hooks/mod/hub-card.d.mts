export type Option = { value: string; label: string }
export type HubCardState = { view: string; child: string; group: string | null; isCollapsed: boolean }
export declare const CARD_TITLE: string
export declare const VIEWS: readonly Option[]
export declare const ALL: string
export declare const DEFAULT_HUB_CARD: Readonly<HubCardState>
export declare const CHILDREN_SHOWN: number
export declare const EVENTS_SHOWN: number
export declare const STATUSES: readonly { status: string; name: string; tone: string; color: string }[]
export declare function baseName(path: unknown): string
export declare function hubStateOf(state: unknown): HubCardState
export declare function statusCounts(children: readonly { status?: string }[]): { status: string; name: string; tone: string; color: string; n: number }[]
export declare function hubCardOf(input: { state: unknown; role?: unknown; master?: unknown; panel?: unknown; log?: unknown }): any
export declare function hubHelpCard(): any
