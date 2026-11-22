// The start line: under the row of a Bash call that starts child sessions, or of the desktop app's session tool,
// one line per child,
// `⎿  🔀 opus   ▰▰▰▱ high   -> <child name>`, drawn like model-router's choose-model line.
// Pure: reads the launch commands of skills/spawn/references/environments/ with the shell lexer: `claude` after
// SESSION_HUB_ROLE=child, tmux's new-window or split-window with the command as arguments (or, as before, typed with
// send-keys -l), and herdr agent start; and the input of the desktop app's start_session call.

import { ARROW, ROUTE_ICON, modelEffortSegments } from './look.mjs';
import { commandName, stripPrefix } from './shell-commands.mjs';
import { tokenize } from './shell-words.mjs';

const ROLE_CHILD = /^SESSION_HUB_ROLE=child$/i;
const TMUX_CREATE = Object.freeze(['new-window', 'neww', 'split-window', 'splitw']);
const NO_EFFORT = 'default';
const FALLBACK_NAME = 'child';

// The value of a flag in `args` before `--`: `--model x`, `--model=x`, and for names also `-n x`.
function flag(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    const text = args[i].value;
    if (text === '--') return undefined;
    for (const name of names) {
      if (text === name) return args[i + 1]?.dynamic ? undefined : args[i + 1]?.value;
      if (name.startsWith('--') && text.startsWith(`${name}=`)) return args[i].dynamic ? undefined : text.slice(name.length + 1);
    }
  }
  return undefined;
}

// The child that `claude` flags start, or nothing when they state neither model nor effort.
function start(args, fallbackName) {
  const model = flag(args, ['--model']);
  const effort = flag(args, ['--effort']);
  if (model === undefined && effort === undefined) return [];
  return [{ name: flag(args, ['-n', '--name']) ?? fallbackName ?? FALLBACK_NAME, model, effort }];
}

// The words of each simple command of a line; substitutions are not looked into.
function simpleCommands(line) {
  const commands = [];
  let words = [];
  for (const token of tokenize(line)) {
    if (token.type === 'word') {
      words.push(token);
    } else if (token.type === 'op') {
      commands.push(words);
      words = [];
    }
  }
  return [...commands, words].filter((list) => list.length > 0);
}

function startsIn(words) {
  const first = words[0] ? commandName(words[0]) : '';
  if (first === 'tmux') {
    // `tmux new-window|split-window … -e SESSION_HUB_ROLE=child … -- claude <flags>`: the command as arguments.
    if (words.some((word) => TMUX_CREATE.includes(word.value))) {
      const claude = words.findIndex((word, i) => i > 0 && !word.dynamic && commandName(word) === 'claude');
      if (claude < 0) return [];
      const variables = words.slice(0, claude).filter((word, i, list) => list[i - 1]?.value === '-e');
      return variables.some((word) => ROLE_CHILD.test(word.value)) ? start(words.slice(claude + 1)) : [];
    }
    if (!words.some((word) => word.value === 'send-keys')) return [];
    const literal = words.findIndex((word) => word.value === '-l');
    const line = literal >= 0 ? words[literal + 1] : undefined;
    return line && !line.dynamic ? childStarts(line.value) : [];
  }
  if (first === 'herdr') {
    const [, verb, action, name] = words.map((word) => word.value);
    const separator = words.findIndex((word) => word.value === '--');
    if (verb !== 'agent' || action !== 'start' || separator < 0) return [];
    return start(words.slice(separator + 1), name);
  }
  const { words: command } = stripPrefix(words);
  if (!command[0] || commandName(command[0]) !== 'claude') return [];
  const before = words.slice(0, words.length - command.length);
  if (!before.some((word) => ROLE_CHILD.test(word.value))) return [];
  return start(command.slice(1));
}

/**
 * The children a command starts, `{ name, model, effort }` each, in the order it starts them. A command the lexer
 * cannot read starts none.
 * @param {string} command
 */
export function childStarts(command) {
  try {
    return simpleCommands(String(command ?? '')).flatMap(startsIn);
  } catch {
    return [];
  }
}

// The desktop app's session-starting tool (skills/spawn/references/environments/desktop-app.md), whatever server
// name the app gives it: `mcp__ccd_session__start_session` today.
const SESSION_START_TOOL = /^mcp__[\w-]+__start_session$/;

/** Whether a tool starts a session the way the desktop app's `start_session` does. */
export function isSessionStartTool(tool) {
  return typeof tool === 'string' && SESSION_START_TOOL.test(tool);
}

const text = (value) => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * The child a session-starting tool call starts, `{ name, model, effort }`, from its input: the name, else the
 * title. Like a launch command, a start that states neither model nor effort gets no line.
 * @param {string} tool
 * @param {unknown} input
 */
export function toolStarts(tool, input) {
  if (!isSessionStartTool(tool) || !input || typeof input !== 'object') return [];
  const model = text(input.model);
  const effort = text(input.effort);
  if (model === undefined && effort === undefined) return [];
  return [{ name: text(input.name) ?? text(input.title) ?? FALLBACK_NAME, model, effort }];
}

/** The line as segments: `{ text, color?, bold?, tone? }`, for the mod to colour. */
export function startLineSegments({ name, model, effort }) {
  return [
    { text: '  ⎿  ', tone: 'dim' },
    { text: `${ROUTE_ICON} ` },
    ...modelEffortSegments(model, effort, { unknown: NO_EFFORT }),
    { text: ` ${ARROW} ${name}`, tone: 'dim' },
  ];
}

/** The line as plain text, without its leading indent. */
export function startLineText(line) {
  return startLineSegments(line).map((segment) => segment.text).join('').trimStart();
}
