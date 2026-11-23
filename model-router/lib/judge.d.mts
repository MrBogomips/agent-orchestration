export declare const DEFAULT_MAX_CHARS: number
export declare function escapeTask(text: string): string
export declare function buildJudgePrompt(
  grid: unknown,
  task: { subagentType?: string; description?: string; prompt?: string },
  options?: { maxChars?: number },
): { system: string; prompt: string }
export declare function parseJudgeAnswer(
  text: string | undefined,
  classes: readonly string[],
): {
  tier: 'fast' | 'balanced' | 'frontier' | 'deep'
  confidence: number | null
  effort: number | null
  effortConfidence: number | null
  risky: number | null
  class: string | null
} | null
