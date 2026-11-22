// Where the report page is shown once it is written: the Claude desktop app's Browser pane, else the system's
// default browser, else nowhere (the line gives the path). Pure: the mod writes the page, asks the engine which
// surfaces the session has, calls the pane's tool and runs the opener.
// See docs/design/model-router.md, "Opening the report".
// Plain ES module with no Node or engine imports, so both the mod and node tests load it.

/** The desktop app's browser as an MCP server, and its tool that opens the Browser pane at a URL. */
export const BROWSER_SERVER = 'Claude_Browser';
export const BROWSER_TOOL = 'preview_start';
/** The surface that has a Browser pane. */
export const PANE_SURFACE = 'desktop';

const REASON_CHARS = 200;
const oneLine = (text) => String(text ?? '').trim().split('\n')[0].slice(0, REASON_CHARS);

/** The `file://` URL of an absolute path, each segment percent-encoded; null for a path that is not absolute. */
export function fileUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Whether the session draws on the surface that has a Browser pane. */
export const hasBrowserPane = (surfaces) => Array.isArray(surfaces) && surfaces.includes(PANE_SURFACE);

/** Why an `$.mcp.connect` answer does not give a server to call, in one line; null when it is connected. */
export function connectRefusal(answer) {
  if (answer?.isConnected === true && typeof answer.server === 'string' && answer.server) return null;
  return oneLine([answer?.reason, answer?.message].filter(Boolean).join(': ')) || 'the Browser pane is not connected';
}

/**
 * Why the pane's tool did not open the page, in one line; null when it did. A result that is missing, denied by a
 * hook (`{ deny }`) or reported as failed by the server (`isError`) is a refusal.
 */
export function paneRefusal(result) {
  if (!result || typeof result !== 'object') return 'the Browser pane gave no answer';
  if ('deny' in result) return oneLine(result.deny) || 'denied';
  if (result.isError) return oneLine((Array.isArray(result.content) ? result.content : []).find((b) => typeof b?.text === 'string')?.text) || 'the Browser pane refused the page';
  return null;
}

/**
 * The one line the person reads: `how` is `pane`, `browser` or `none`; `why` says, for `none`, why nothing was
 * opened.
 */
export function reportLine(how, file, why) {
  if (how === 'pane') return `Report opened in the Browser pane: ${file}`;
  if (how === 'browser') return `Report opened in the default browser: ${file}`;
  return `Report written to ${file} (not opened: ${oneLine(why) || 'no browser could be opened'})`;
}
