export type Token =
  | { type: 'word'; value: string; dynamic: boolean; descriptor?: true; braces?: true; equals?: true; subs?: Token[][] }
  | { type: 'op'; value: string }
  | { type: 'redirect'; value: string; fd: string }
  | { type: 'subst'; tokens: Token[] }

export function tokenize(line: string, depth?: number): Token[]
