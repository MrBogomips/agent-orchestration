// The shell check: a best-effort look at a child's shell command (Bash, Monitor) for files it would write outside
// the write root. Spike S10 showed a model write outside its root through the shell when nothing told it not to;
// the classic scope guard sees only Edit, Write and NotebookEdit.
//
// Best effort, by design: it reads redirections and the targets of common file-writing commands (tee, touch, mkdir,
// rm, rmdir, truncate, unlink, cp, mv, ln, install, sed -i), behind assignments, wrappers (sudo, env, nice,
// timeout, xargs, command, nohup, time, builtin, exec) and reserved words (if, then, elif, else, while, until, do,
// !, {, function). It does not judge targets it cannot know without running the shell (a variable, a command
// substitution, a glob, a relative path after a `cd` or a wrapper's change of folder), nor writes made by any
// other program. Writes under /dev and the system temporary folders are allowed, judged on the resolved path.
//
// `..` is resolved the way the kernel does: against where the part before it really lands (symbolic links
// followed), not by removing the previous name, so `link/../x` is judged where it lands and `../sibling` keeps
// working.
//
// It fails closed when it cannot evaluate a command it found targets in: no write root, an unknown role, a
// command it cannot parse, a path it cannot resolve (`~` without HOME, `~user`, a relative path without a working
// folder, a link that leads nowhere).

import { tokenize } from './shell-words.mjs';

const PREFIX = '[session-hub]';
const ALLOW = Object.freeze({ allow: true });
const ALLOWED_ROOTS = Object.freeze(['/dev', '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']);
// Wrappers before the real command: their options that take a value, the ones whose value is optional and only
// attached, the ones that change the folder, and how many operands come before the command.
const WRAPPERS = Object.freeze({
  sudo: {
    values: ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-D', '-T', '--user', '--group', '--host', '--prompt',
      '--close-from', '--other-user', '--role', '--type', '--chdir', '--command-timeout'],
    chdir: ['-D', '--chdir'],
  },
  env: { values: ['-u', '-C', '-S', '--unset', '--chdir', '--split-string'], chdir: ['-C', '--chdir'] },
  nice: { values: ['-n', '--adjustment'] },
  timeout: { values: ['-s', '-k', '--signal', '--kill-after'], operands: 1 },
  xargs: {
    values: ['-a', '-d', '-E', '-I', '-L', '-n', '-P', '-s', '-J', '-R', '-S', '--arg-file', '--delimiter',
      '--max-lines', '--max-args', '--max-procs', '--max-chars', '--process-slot-var'],
    optional: ['-e', '-i', '-l'],
  },
  command: {},
  nohup: {},
  time: { values: ['-o', '-f', '--output', '--format'] },
  builtin: {},
  exec: { values: ['-a'] },
});
// Reserved words that may come before a command; `function` also takes the function's name.
const RESERVED = Object.freeze(['if', 'then', 'elif', 'else', 'while', 'until', 'do', '!', '{']);
const ALL_ARGS = Object.freeze(['tee', 'touch', 'mkdir', 'rm', 'rmdir', 'truncate', 'unlink']);
const LAST_ARG = Object.freeze(['cp', 'mv', 'ln', 'install']);
const TARGET_DIRECTORY = Object.freeze(['-t', '--target-directory']);
// Options that take a value, per command: only the target directory among them is written.
const VALUE_OPTIONS = Object.freeze({
  touch: ['-r', '-d', '-t', '--reference', '--date'],
  mkdir: ['-m', '--mode'],
  truncate: ['-s', '-r', '--size', '--reference'],
  install: ['-m', '-o', '-g', '-t', '-S', '--mode', '--owner', '--group', '--target-directory', '--suffix'],
  cp: ['-t', '-S', '--target-directory', '--suffix'],
  mv: ['-t', '-S', '--target-directory', '--suffix'],
  ln: ['-t', '-S', '--target-directory', '--suffix'],
});
const SED_VALUES = Object.freeze(['-e', '-f', '-l', '--expression', '--file', '--line-length']);
const SED_SCRIPTS = Object.freeze(['-e', '-f', '--expression', '--file']);
const DIRECTORY_CHANGES = Object.freeze(['cd', 'pushd', 'popd']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const advice =
  'Do not retry this write through another command or tool. Send an `out-of-scope` message to the master, saying ' +
  'what you need written and why, and tell the user that you passed the request to the master.';

// Splits the tokens into simple commands, each with its words and its redirection targets.
function simpleCommands(tokens) {
  const commands = [];
  let current = { words: [], redirects: [] };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'op') {
      if (token.value === '<') {
        i += 1; // the input file is read, not written
        continue;
      }
      commands.push(current);
      current = { words: [], redirects: [] };
    } else if (token.type === 'redirect') {
      const target = tokens[i + 1];
      if (target?.type === 'word') {
        current.redirects.push(target);
        i += 1;
      }
    } else {
      current.words.push(token);
    }
  }
  commands.push(current);
  return commands.filter((command) => command.words.length > 0 || command.redirects.length > 0);
}

const isOption = (word) => word.value.startsWith('-') && word.value !== '-';

const basename = (word) => word.value.slice(word.value.lastIndexOf('/') + 1);

const valueWord = (word, value) => ({ ...word, value });

// Reads one option word at args[i] (a long option, or a cluster of short ones such as `-rt DIR` or `-m644`).
// `values` take a value, attached or in the next word; `optional` take only an attached one. Returns the options
// read, each `{ name, value? }`, and how many words they used.
function readOption(args, i, values, optional) {
  const word = args[i];
  const text = word.value;
  if (text.startsWith('--')) {
    const eq = text.indexOf('=');
    if (eq > 0) return { options: [{ name: text.slice(0, eq), value: valueWord(word, text.slice(eq + 1)) }], used: 1 };
    if (values.includes(text)) return { options: [{ name: text, value: args[i + 1] }], used: 2 };
    return { options: [{ name: text }], used: 1 };
  }
  const options = [];
  for (let k = 1; k < text.length; k += 1) {
    const name = `-${text[k]}`;
    const rest = text.slice(k + 1);
    if (optional.includes(name)) return { options: [...options, { name, value: valueWord(word, rest) }], used: 1 };
    if (values.includes(name)) {
      if (rest !== '') return { options: [...options, { name, value: valueWord(word, rest) }], used: 1 };
      return { options: [...options, { name, value: args[i + 1] }], used: 2 };
    }
    options.push({ name });
  }
  return { options, used: 1 };
}

// Splits arguments into options and operands. With `stopAtOperand`, stops at the first operand and returns the
// words from there as `rest`.
function parseArgs(args, { values = [], optional = [], stopAtOperand = false } = {}) {
  const options = [];
  const operands = [];
  let ended = false;
  let i = 0;
  while (i < args.length) {
    if (ended || !isOption(args[i])) {
      if (stopAtOperand) break;
      operands.push(args[i]);
      i += 1;
    } else if (args[i].value === '--') {
      ended = true;
      i += 1;
    } else {
      const read = readOption(args, i, values, optional);
      options.push(...read.options);
      i += read.used;
    }
  }
  return { options, operands, rest: args.slice(i) };
}

const hasOption = (options, names) => options.some((option) => names.includes(option.name));

// Drops leading assignments, reserved words and wrappers (`if LC_ALL=C sudo -u root timeout 5 rm …`), so the
// first word is the command. Also says whether a wrapper changes the folder (`env -C DIR`).
function stripPrefix(words) {
  let rest = words;
  let changesDirectory = false;
  while (rest.length > 0) {
    const [first, ...after] = rest;
    if (ASSIGNMENT.test(first.value) || RESERVED.includes(first.value)) {
      rest = after;
      continue;
    }
    if (first.value === 'function') {
      rest = after.slice(1);
      continue;
    }
    if (!Object.hasOwn(WRAPPERS, basename(first))) break;
    const wrapper = WRAPPERS[basename(first)];
    const parsed = parseArgs(after, { ...wrapper, stopAtOperand: true });
    if (hasOption(parsed.options, wrapper.chdir ?? [])) changesDirectory = true;
    rest = parsed.rest.slice(wrapper.operands ?? 0);
  }
  return { words: rest, changesDirectory };
}

function sedTargets(args) {
  const { options, operands } = parseArgs(args, { values: SED_VALUES, optional: ['-i'] });
  if (!hasOption(options, ['-i', '--in-place'])) return [];
  // BSD sed: `-i ''`, an empty suffix in the next word.
  const files = operands[0]?.value === '' ? operands.slice(1) : operands;
  return hasOption(options, SED_SCRIPTS) ? files : files.slice(1);
}

function commandTargets(words) {
  const [name, ...args] = words;
  if (!name) return [];
  const command = basename(name);
  if (command === 'sed') return sedTargets(args);
  const { options, operands } = parseArgs(args, { values: VALUE_OPTIONS[command] ?? [] });
  if (ALL_ARGS.includes(command)) return operands;
  if (!LAST_ARG.includes(command)) return [];
  const targetDirectory = options.filter((option) => TARGET_DIRECTORY.includes(option.name) && option.value);
  if (targetDirectory.length > 0) return targetDirectory.map((option) => option.value);
  if (command === 'install' && hasOption(options, ['-d', '--directory'])) return operands;
  return operands.length >= 2 ? [operands[operands.length - 1]] : [];
}

function analyse(command) {
  let changesDirectory = false;
  const targets = [];
  for (const simple of simpleCommands(tokenize(command))) {
    const stripped = stripPrefix(simple.words);
    const first = stripped.words[0];
    if (stripped.changesDirectory || (first && DIRECTORY_CHANGES.includes(basename(first)))) changesDirectory = true;
    targets.push(...simple.redirects, ...commandTargets(stripped.words));
  }
  return { targets: targets.filter((word) => !word.value.startsWith('&')), changesDirectory };
}

/** The write targets a command line names, as written. Throws on a line it cannot parse. */
export function shellWriteTargets(command) {
  return analyse(command).targets.map((word) => word.value);
}

/** Lexical normalisation of an absolute POSIX path: `.`, `..` and repeated slashes resolved. */
export function normalizePath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

const isUnder = (path, root) => path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
const isAllowedPlace = (path) => ALLOWED_ROOTS.some((root) => isUnder(path, root));

// The absolute form of a target, `..` still in it; undefined when it cannot be known without running the shell
// (a variable, a substitution, a glob, a relative path after a change of folder). Throws when it names a place
// that cannot be resolved here.
function absoluteTarget(word, { cwd, home, changesDirectory }) {
  if (word.dynamic || word.value === '') return undefined;
  let value = word.value;
  if (value.startsWith('~')) {
    const user = value.slice(1).split('/')[0];
    if (user !== '') throw new Error(`cannot resolve ${value}: another user's home folder`);
    if (!home) throw new Error(`cannot resolve ${value}: HOME is not set`);
    value = `${home}${value.slice(1)}`;
  }
  if (value.startsWith('/')) return value;
  if (changesDirectory) return undefined;
  if (!cwd) throw new Error(`cannot resolve ${value}: the working folder is unknown`);
  return `${cwd}/${value}`;
}

const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/';

// Folds `.` and `..` the way the kernel does: each `..` goes up from where the part before it really lands.
async function foldDots(path, realpath) {
  let current = '/';
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') current = parentOf(await realpath(current));
    else current = current === '/' ? `/${part}` : `${current}/${part}`;
  }
  return current;
}

function writeRoot(role) {
  if (role.kind === 'invalid') {
    throw new Error(`SESSION_HUB_ROLE has an unknown value (${role.raw}); expected child`);
  }
  if (!role.scopeRoot) throw new Error('SESSION_HUB_SCOPE_ROOT is not set');
  if (!role.scopeRoot.startsWith('/')) throw new Error(`SESSION_HUB_SCOPE_ROOT is not an absolute path (${role.scopeRoot})`);
  return normalizePath(role.scopeRoot);
}

const block = (why) => Object.freeze({ allow: false, reason: `${PREFIX} Shell command blocked: ${why}` });

/**
 * @param {{ role: ReturnType<typeof import('./role.mjs').readRole>, command: string, cwd?: string, home?: string,
 *   realpath: (path: string) => Promise<string> }} input  `realpath` resolves symbolic links in the existing part
 * @returns {Promise<{ allow: true } | { allow: false, reason: string }>}
 */
export async function judgeShell({ role, command, cwd, home, realpath }) {
  if (!role.guarding) return ALLOW;
  try {
    const { targets, changesDirectory } = analyse(String(command ?? ''));
    const written = targets
      .map((word) => absoluteTarget(word, { cwd, home, changesDirectory }))
      .filter((path) => path !== undefined);
    if (written.length === 0) return ALLOW;
    let root;
    for (const target of written) {
      const path = await foldDots(target, realpath);
      if (isUnder(path, '/dev')) continue;
      root ??= await realpath(writeRoot(role));
      const real = await realpath(path);
      if (isUnder(real, root) || isAllowedPlace(real)) continue;
      return block(`it writes ${path}, outside this child's write root ${root}. ${advice}`);
    }
    return ALLOW;
  } catch (error) {
    return block(
      `the session-hub shell check could not evaluate this command (${error?.message ?? error}). A guard that ` +
        'cannot evaluate does not let the call pass. Tell the user, and ask the master if the scope is wrong.',
    );
  }
}
