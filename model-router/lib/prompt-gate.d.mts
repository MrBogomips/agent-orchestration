export declare const PROMPTS_AFTER_REPORT: number
export declare function promptGate(windowMin: number): {
  reported(ms: number): void
  shouldRecord(ms: number): boolean
}
