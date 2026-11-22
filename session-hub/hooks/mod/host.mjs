// Where the session is shown, for what opens beside the chat: a terminal, a graphical host or nowhere. Pure: the
// mod passes the surfaces the session draws on and the entry point Claude Code was started through.
// The same rule as model-router's (its lib/open-report.mjs): each plugin keeps its own copy.

/** Whether a surface draws native elements in a proportional font: every surface but the terminal. */
export const isGraphical = (surface) => typeof surface === 'string' && surface !== '' && surface !== 'terminal';

// Started from a shell (`cli`, as `claude -p`) or through the SDK, Claude Code draws nowhere of its own. Any other
// entry point is an app that hosts the session and attaches its surface at its first draw.
const isHeadlessEntry = (entrypoint) => {
  const entry = String(entrypoint ?? '').trim().toLowerCase();
  return entry === '' || entry === 'cli' || entry.startsWith('sdk');
};

/**
 * `terminal` when a terminal is attached; `graphical` when only graphical surfaces are, or when none is attached
 * yet and an app hosts the session (`entrypoint`, the value of CLAUDE_CODE_ENTRYPOINT); `headless` otherwise.
 */
export function hostKind({ surfaces, entrypoint } = {}) {
  const list = Array.isArray(surfaces) ? surfaces : [];
  if (list.includes('terminal')) return 'terminal';
  if (list.some(isGraphical)) return 'graphical';
  return isHeadlessEntry(entrypoint) ? 'headless' : 'graphical';
}
