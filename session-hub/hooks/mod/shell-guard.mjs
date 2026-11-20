// The shell check: a best-effort look at a child's Bash command for files it would write outside the write root.
// Spike S10 showed a model write outside its root through the shell when nothing told it not to; the classic scope
// guard sees only Edit, Write and NotebookEdit.
//
// Best effort, by design: it reads redirections and the targets of common file-writing commands (tee, touch, mkdir,
// rm, rmdir, truncate, unlink, cp, mv, ln, install, sed -i). It does not judge targets it cannot know without
// running the shell (a variable, a command substitution, a glob, a relative path after a `cd`), nor writes made by
// any other program. Writes under /dev and the system temporary folders are allowed, judged on the resolved path.
//
// It fails closed when it cannot evaluate a command it found targets in: no write root, an unknown role, a
// command it cannot parse, a path it cannot resolve.

import { tokenize } from './shell-words.mjs';

const PREFIX = '[session-hub]';
const ALLOW = Object.freeze({ allow: true });
const ALLOWED_ROOTS = Object.freeze(['/dev', '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']);
// Wrappers before the real command, with their options that take a value.
const WRAPPERS = Object.freeze({
  sudo: ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-D'],
  env: ['-u', '-C', '-S'],
  nice: ['-n'],
  command: [],
  nohup: [],
  time: [],
  builtin: [],
  exec: [],
});
const ALL_ARGS = Object.freeze(['tee', 'touch', 'mkdir', 'rm', 'rmdir', 'truncate', 'unlink']);
const LAST_ARG = Object.freeze(['cp', 'mv', 'ln', 'install']);
// Options whose value is read, not written, per command.
const VALUE_OPTIONS = Object.freeze({
  touch: ['-r', '-d', '-t'],
  mkdir: ['-m'],
  truncate: ['-s', '-r'],
  install: ['-m', '-o', '-g', '-t'],
  cp: ['-t'],
  mv: ['-t'],
  ln: ['-t'],
});
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

// Drops leading assignments and wrappers (`LC_ALL=C sudo -u root env X=1 rm …`), so the first word is the command.
function stripPrefix(words) {
  let i = 0;
  while (i < words.length) {
    const name = basename(words[i]);
    if (ASSIGNMENT.test(words[i].value)) {
      i += 1;
    } else if (Object.hasOwn(WRAPPERS, name)) {
      i += 1;
      while (i < words.length && (isOption(words[i]) || (name === 'env' && ASSIGNMENT.test(words[i].value)))) {
        i += WRAPPERS[name].includes(words[i].value) ? 2 : 1;
      }
    } else {
      break;
    }
  }
  return words.slice(i);
}

function sedTargets(args) {
  const inPlace = args.some((word) => /^-i/.test(word.value) || word.value.startsWith('--in-place'));
  if (!inPlace) return [];
  const operands = [];
  let hasScript = false;
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i].value;
    if (value === '-i' && args[i + 1]?.value === '') {
      i += 1; // BSD sed: `-i ''`
    } else if (value === '-e' || value === '-f') {
      hasScript = true;
      i += 1;
    } else if (!isOption(args[i])) {
      operands.push(args[i]);
    }
  }
  return hasScript ? operands : operands.slice(1);
}

// Splits a command's arguments into operands and the target directory a `-t` or `--target-directory=` names.
function operandsOf(command, args) {
  const takesValue = VALUE_OPTIONS[command] ?? [];
  const operands = [];
  let targetDirectory;
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i].value;
    if (value.startsWith('--target-directory=')) {
      targetDirectory = { ...args[i], value: value.slice('--target-directory='.length) };
    } else if (takesValue.includes(value)) {
      if (value === '-t' && LAST_ARG.includes(command) && args[i + 1]) targetDirectory = args[i + 1];
      i += 1;
    } else if (!isOption(args[i])) {
      operands.push(args[i]);
    }
  }
  return { operands, targetDirectory };
}

function commandTargets(words) {
  const [name, ...args] = stripPrefix(words);
  if (!name) return [];
  const command = basename(name);
  if (command === 'sed') return sedTargets(args);
  const { operands, targetDirectory } = operandsOf(command, args);
  if (ALL_ARGS.includes(command)) return operands;
  if (!LAST_ARG.includes(command)) return [];
  if (targetDirectory) return [targetDirectory];
  if (command === 'install' && args.some((word) => word.value === '-d')) return operands;
  return operands.length >= 2 ? [operands[operands.length - 1]] : [];
}

function analyse(command) {
  const commands = simpleCommands(tokenize(command));
  const changesDirectory = commands.some((c) => DIRECTORY_CHANGES.includes(basename(stripPrefix(c.words)[0] ?? { value: '' })));
  const targets = commands.flatMap((c) => [...c.redirects, ...commandTargets(c.words)]);
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

// The absolute form of a target, or undefined when it cannot be known without running the shell.
function absoluteTarget(word, { cwd, home, changesDirectory }) {
  if (word.dynamic || word.value === '') return undefined;
  let value = word.value;
  if (value === '~' || value.startsWith('~/')) {
    if (!home) return undefined;
    value = `${home}${value.slice(1)}`;
  } else if (value.startsWith('~')) {
    return undefined;
  }
  if (value.startsWith('/')) return normalizePath(value);
  if (changesDirectory || !cwd) return undefined;
  return normalizePath(`${cwd}/${value}`);
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
    const paths = targets
      .map((word) => absoluteTarget(word, { cwd, home, changesDirectory }))
      .filter((path) => path !== undefined && !isUnder(path, '/dev'));
    if (paths.length === 0) return ALLOW;
    const root = await realpath(writeRoot(role));
    for (const path of paths) {
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
