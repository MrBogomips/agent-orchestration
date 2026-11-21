export type RouteLine = { model: string; effort?: string | null; reason: string }
export type LineParts = {
  icon: string
  model: string
  modelColor: string | null
  filled: string
  empty: string
  effort: string
  effortColor: string | null
  reason: string
}
export declare const ROUTE_ICON: string
export declare const ARROW: string
export declare const CELL_FULL: string
export declare const CELL_EMPTY: string
export declare const MODEL_WIDTH: number
export declare const EFFORT_WIDTH: number
export declare const NO_EFFORT: string
export declare const MODEL_COLORS: Readonly<Record<string, string>>
export declare const EFFORT_COLORS: Readonly<Record<string, string>>
export declare const EMPTY_COLOR: string
export declare function effortBar(level: unknown): string
export declare function modelName(model: unknown): string
export declare function routeReason(input: {
  route: string
  action?: string
  reason?: string
  cls?: string | null
  judgeTier?: string | null
  before?: string
  after?: string
  effortSet?: boolean
}): string
export declare function lineParts(line: RouteLine, options?: { pad?: boolean }): LineParts
export declare function plainLine(line: RouteLine, options?: { pad?: boolean }): string
