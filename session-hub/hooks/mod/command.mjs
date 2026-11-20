// The arguments of /session-hub. Pure: the mod passes the text typed after the command name.

/**
 * What `/session-hub <args>` asks for: `{ kind: 'show' }` (no argument), `{ kind: 'help' }`, or
 * `{ kind: 'unknown', word }`.
 */
export function parseCommand(args) {
  const words = String(args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { kind: 'show' };
  if (words.length === 1 && ['help', '-h', '--help', '?'].includes(words[0])) return { kind: 'help' };
  return { kind: 'unknown', word: words[0] };
}

/** What the command does, one line each. */
export function helpText() {
  return [
    'Usage: /session-hub [help]',
    '',
    '  (none)   this session\'s role and scope; in a master, also the children table,',
    '           and the children panel opened beside the chat (refreshed every 30 s)',
    '  help     this list',
    '',
    'The output is for you only: the model has the scope in its own scope line,',
    'and reads the children from the record.',
  ].join('\n');
}
