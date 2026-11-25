export declare function selfFromListing(output: unknown): { name: string; ref: string } | undefined
export declare function recordedMaster(record: unknown): { name: string; ref?: string; sessionId?: string } | undefined
export declare function renameNotice(input: {
  record: unknown
  current: { name: string } | undefined
  sessionId?: string
}): { name: string; text: string } | undefined
export declare function outboxNote(count: unknown): string | undefined
