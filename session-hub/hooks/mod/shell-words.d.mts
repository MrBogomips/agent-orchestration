export type Token =
  | { type: 'word'; value: string; dynamic: boolean }
  | { type: 'op'; value: string }
  | { type: 'redirect'; value: string; fd: string }

export function tokenize(line: string): Token[]
