// Where the session is shown, and where the quality report opens: from a terminal as the HTML page in the system's
// default browser; on a graphical surface (the Claude desktop app, the editor, the phones) the report is the card's
// Trend view instead. Pure: the mod asks the engine which surfaces the session draws on, writes the page and runs
// the opener.
// See docs/design/model-router.md, "Opening the report".
// Plain ES module with no Node or engine imports, so both the mod and node tests load it.

const REASON_CHARS = 200;
const oneLine = (text) => String(text ?? '').trim().split('\n')[0].slice(0, REASON_CHARS);

/** Whether a surface draws native elements in a proportional font: every surface but the terminal. */
export const isGraphical = (surface) => typeof surface === 'string' && surface !== '' && surface !== 'terminal';

// How Claude Code was started when it draws nowhere of its own: from a shell (`cli`, as `claude -p`) or through
// the SDK. Any other entry point is an app that hosts the session and attaches its surface at its first draw.
const isHeadlessEntry = (entrypoint) => {
  const entry = String(entrypoint ?? '').trim().toLowerCase();
  return entry === '' || entry === 'cli' || entry.startsWith('sdk');
};

/**
 * What kind of place the session is shown in: `terminal` when a terminal is attached; `graphical` when only
 * graphical surfaces are, or when none is attached yet and an app hosts the session (`entrypoint`, the value of
 * CLAUDE_CODE_ENTRYPOINT: a hosting app attaches its surface only at its first draw); `headless` otherwise (a
 * `-p` run, the SDK), where nothing is ever drawn.
 */
export function hostKind({ surfaces, entrypoint } = {}) {
  const list = Array.isArray(surfaces) ? surfaces : [];
  if (list.includes('terminal')) return 'terminal';
  if (list.some(isGraphical)) return 'graphical';
  return isHeadlessEntry(entrypoint) ? 'headless' : 'graphical';
}

/**
 * The one line the person reads: `how` is `browser` (the page, in the default browser) or `none` (the page,
 * written and not opened: `why` says why).
 */
export function reportLine(how, file, why) {
  if (how === 'browser') return `Report opened in the default browser: ${file}`;
  return `Report written to ${file} (not opened: ${oneLine(why) || 'no browser could be opened'})`;
}
