export declare const OUTBOX_VERSION: number
export declare const OUTBOX_FILE: RegExp
export declare const MAX_TEXT: number
export declare function outboxDir(record: unknown): string | undefined
export declare function outboxEntry(input: {
  dir: string
  at: string
  sessionId?: string
  nonce: string
  master: string
  reason?: string
  text: string
}): { file: string; content: string }
export type OutboxMessage = {
  file: string
  at?: string
  from?: string | null
  to?: string
  reason?: string | null
  text?: string
  cut?: number
  error?: string
}
export declare function readOutboxMessage(name: string, content: string): OutboxMessage
export declare function undeliveredText(input: { master: string; reason?: string; saved?: string; error?: unknown }): string
