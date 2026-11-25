#!/usr/bin/env node
// session-hub handoff: SessionStart hook (startup, clear, compact).
//
// In a child session (SESSION_HUB_ROLE=child) it adds the handoff file named by SESSION_HUB_HANDOFF to the model's
// context, at the start and again after /clear and a compaction. The child therefore needs no access to the folder
// that holds the handoff: no `--add-dir`, and no "Is this a directory you trust?" dialog at every start (#101).
// It does nothing in any other session.
//
// Claude Code keeps up to 10,000 characters of a hook's context and turns a longer one into a short preview and a
// file (spikes.md, S22), so a longer handoff is cut at a line, and the context says from which line to read the rest.
// It never blocks the session: a handoff it cannot read is named in the context and shown to the user, and the
// child's first prompt still names the file.
//
// Output contract: exit 0, and on stdout nothing, or the JSON of a SessionStart hook (`hookSpecificOutput` with
// `additionalContext`, and `systemMessage` for the user when the handoff could not be read).

import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIX = '[session-hub]';
// Below Claude Code's 10,000 characters, with room for the header and the note on the rest.
export const MAX_CONTEXT = 9500;
// The sources the hook answers; `resume` keeps the context the transcript already has.
const SOURCES = Object.freeze(['startup', 'clear', 'compact']);

const normalize = (value) => String(value ?? '').trim().toLowerCase();

const header = (file) =>
  `${PREFIX} Your handoff, from ${file}. Follow it. session-hub adds it again after a compaction, so you do not ` +
  'need to read the file.\n\n';

const restNote = (file, line) =>
  `\n\n${PREFIX} The handoff is longer than session-hub can add here: read the rest of ${file} from line ${line}.`;

const output = (context, systemMessage) =>
  Object.freeze({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
    ...(systemMessage ? { systemMessage } : {}),
  });

function unreadable(file, why) {
  return output(
    `${PREFIX} Your handoff ${file || '(not set)'} could not be read: ${why}. Without it you have no task: tell the ` +
      'user, and ask the master for the handoff if you can reach it.',
    `${PREFIX} The handoff could not be read (${why}): ${file || 'SESSION_HUB_HANDOFF is not set'}.`,
  );
}

// The handoff's text cut at a line so that it fits in `room` characters; the line where the rest starts, or 0.
function fit(text, room) {
  if (text.length <= room) return { body: text, restLine: 0 };
  const cut = text.lastIndexOf('\n', room);
  const body = cut > 0 ? text.slice(0, cut) : text.slice(0, room);
  return { body, restLine: body.split('\n').length + (cut > 0 ? 1 : 0) };
}

/**
 * The hook's output for one SessionStart event, or undefined when there is nothing to add.
 * @param {{ env: Record<string, string | undefined>, source?: string, read: (file: string) => string }} input
 */
export function handoffOutput({ env, source, read }) {
  if (normalize(env.SESSION_HUB_ROLE) !== 'child') return undefined;
  if (source !== undefined && !SOURCES.includes(source)) return undefined;
  const file = String(env.SESSION_HUB_HANDOFF ?? '').trim();
  if (file === '') return unreadable('', 'SESSION_HUB_HANDOFF is not set');
  if (!isAbsolute(file)) return unreadable(file, 'not an absolute path');
  let text;
  try {
    text = read(file);
  } catch (error) {
    return unreadable(file, error?.code ?? error?.message ?? String(error));
  }
  if (text.trim() === '') return unreadable(file, 'the file is empty');
  const head = header(file);
  const whole = fit(text, MAX_CONTEXT - head.length);
  if (whole.restLine === 0) return output(head + text);
  // Room for the note with a line number of any length a handoff can have.
  const noteRoom = restNote(file, Number.MAX_SAFE_INTEGER).length;
  const part = fit(text, MAX_CONTEXT - head.length - noteRoom);
  return output(head + part.body + restNote(file, part.restLine));
}

function sourceOf(stdin) {
  try {
    const source = JSON.parse(stdin)?.source;
    return typeof source === 'string' ? source : undefined;
  } catch {
    return undefined;
  }
}

function main() {
  let stdin = '';
  try {
    stdin = readFileSync(0, 'utf8');
  } catch {
    // No input: answer as for a start.
  }
  const result = handoffOutput({ env: process.env, source: sourceOf(stdin), read: (file) => readFileSync(file, 'utf8') });
  if (result) process.stdout.write(JSON.stringify(result));
}

// The exit code is always 0 and set, not forced with process.exit, so stdout is flushed to the pipe first.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${PREFIX} handoff hook: ${error instanceof Error ? error.message : error}\n`);
  }
  process.exitCode = 0;
}
