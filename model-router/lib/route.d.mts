type Judged = {
  tier: string
  confidence: number | null
  effort: number | null
  effortConfidence: number | null
  risky: number | null
} | null

type Thresholds = { minDowngradeConfidence: number; minUpgradeConfidence: number; riskThreshold: number }

export declare const INHERITING_BUILTINS: readonly string[]
export declare function definitionCase(subagentType: string, definitionText?: string): 'inherit' | 'fixed' | 'unknown'
export declare function routeCase(input: {
  subagentType: string
  model?: string
  enabled: boolean
  routeSubagents: boolean
  forcedModel?: string
  definition: string
}): { route: 'off' | 'fork' | 'explicit' | 'forced' | 'fixed' | 'judge'; reason: string }
export declare function isRisky(judge: Judged, tagRisky: boolean, riskThreshold: number): boolean
export declare function decideEffort(input: {
  judge: Judged
  explicitEffort?: string
  risky: boolean
  options: Thresholds
}): string | undefined
export declare function decideModel(input: {
  judge: Judged
  current: string | undefined
  risky: boolean
  options: Thresholds
  models: Record<string, string>
}): { action: 'downgrade' | 'upgrade' | 'keep' | 'forced-risk'; model?: string; reason: string }
