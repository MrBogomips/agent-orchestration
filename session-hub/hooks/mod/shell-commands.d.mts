import type { Token } from './shell-words.mjs'

type Word = Extract<Token, { type: 'word' }>
type Option = { name: string; value?: Word }

export function commandName(word: Word): string

export function parseArgs(
  args: Word[],
  settings?: { values?: string[]; optional?: string[]; stopAtOperand?: boolean },
): { options: Option[]; operands: Word[]; rest: Word[] }

export function hasOption(options: Option[], names: string[]): boolean

export function stripPrefix(words: Word[]): { words: Word[]; changesDirectory: boolean }

export function commandEffects(words: Word[]): {
  targets: Word[]
  ownLinks: Word[]
  hard: Word[]
  symbolic: { at: Word; source: Word; maybeFolder: boolean; fromWorkingFolder: boolean }[]
}

export function shellLine(words: Word[]): { line: string | undefined; sameShell: boolean } | undefined
