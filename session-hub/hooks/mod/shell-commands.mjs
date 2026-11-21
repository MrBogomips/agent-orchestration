// What the shell check knows about single commands: the wrappers and reserved words that may come before the real
// command, the files a command writes, the links it makes, and the command line it hands to a shell (`eval`,
// `sh -c`). Works on the words of one simple command, as `shell-words.mjs` gives them.

import { tokenize } from './shell-words.mjs';

// Wrappers before the real command: their options that take a value, the ones whose value is optional and only
// attached, the ones that change the folder, and how many operands come before the command. `noglob`, `nocorrect`,
// `-` and `repeat N` are zsh's.
const WRAPPERS = Object.freeze({
  sudo: {
    values: ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-D', '-T', '--user', '--group', '--host', '--prompt',
      '--close-from', '--other-user', '--role', '--type', '--chdir', '--command-timeout'],
    chdir: ['-D', '--chdir'],
  },
  env: { values: ['-u', '-C', '-S', '-P', '--unset', '--chdir', '--split-string'], chdir: ['-C', '--chdir'], split: ['-S', '--split-string'] },
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
  noglob: {},
  nocorrect: {},
  '-': {},
  repeat: { operands: 1 },
  coproc: {},
});
// Reserved words that may come before a command; `function` also takes the function's name.
const RESERVED = Object.freeze(['if', 'then', 'elif', 'else', 'while', 'until', 'do', '!', '{', '}', 'always']);
const ALL_ARGS = Object.freeze(['tee', 'touch', 'mkdir', 'rm', 'rmdir', 'truncate', 'unlink']);
const LAST_ARG = Object.freeze(['cp', 'mv', 'ln', 'install']);
const TARGET_DIRECTORY = Object.freeze(['-t', '--target-directory']);
// Options that take a value, per command: only the target directory among them is written. A short option that
// takes a value with GNU but none on macOS (`cp -S`, `sed -l`) is read as taking none: then at worst an extra word is
// judged as a file, and none is hidden.
const VALUE_OPTIONS = Object.freeze({
  touch: ['-r', '-d', '-t', '--reference', '--date'],
  mkdir: ['-m', '--mode'],
  truncate: ['-s', '-r', '--size', '--reference'],
  install: ['-m', '-o', '-g', '-t', '--mode', '--owner', '--group', '--target-directory', '--suffix'],
  cp: ['-t', '--target-directory', '--suffix'],
  mv: ['-t', '--target-directory', '--suffix'],
  ln: ['-t', '--target-directory', '--suffix'],
});
const SED_VALUES = Object.freeze(['-e', '-f', '--expression', '--file', '--line-length']);
const SED_SCRIPTS = Object.freeze(['-e', '-f', '--expression', '--file']);
// Shells whose `-c` runs a command line; their options that take a value.
const SHELLS = Object.freeze(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const SHELL_VALUES = Object.freeze(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[.*\])?\+?=/;

const isOption = (word) => word.value.startsWith('-') && word.value !== '-';

const basename = (word) => word.value.slice(word.value.lastIndexOf('/') + 1);

/** The command a word names: its last path part, without zsh's `=` (`=touch` runs touch). */
export const commandName = (word) => basename(word).replace(/^=/, '');

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

/**
 * Splits arguments into options and operands. With `stopAtOperand`, stops at the first operand and returns the
 * words from there as `rest`.
 */
export function parseArgs(args, { values = [], optional = [], stopAtOperand = false } = {}) {
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

export const hasOption = (options, names) => options.some((option) => names.includes(option.name));

/**
 * Drops leading assignments, reserved words and wrappers (`if LC_ALL=C sudo -u root timeout 5 rm …`), so the
 * first word is the command. Also says whether a wrapper changes the folder (`env -C DIR`).
 */
export function stripPrefix(words) {
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
    const name = commandName(first);
    if (!Object.hasOwn(WRAPPERS, name)) break;
    if (name === 'coproc' && after[1]?.value === '{') {
      rest = after.slice(1); // `coproc NAME { … }`: the name of the coprocess, then its body
      continue;
    }
    const wrapper = WRAPPERS[name];
    const parsed = parseArgs(after, { ...wrapper, stopAtOperand: true });
    if (hasOption(parsed.options, wrapper.chdir ?? [])) changesDirectory = true;
    rest = [...splitWords(parsed.options, wrapper.split ?? []), ...parsed.rest.slice(wrapper.operands ?? 0)];
  }
  return { words: rest, changesDirectory };
}

// `env -S 'cmd args'`: the string is split into words that come before the rest. A string that is not literal
// gives nothing to judge.
function splitWords(options, names) {
  return options
    .filter((option) => names.includes(option.name) && option.value && !option.value.dynamic)
    .flatMap((option) => tokenize(option.value.value).filter((token) => token.type === 'word'));
}

function sedTargets(args) {
  const { options, operands } = parseArgs(args, { values: SED_VALUES, optional: ['-i'] });
  if (!hasOption(options, ['-i', '--in-place'])) return [];
  // BSD sed: `-i ''`, an empty suffix in the next word.
  const files = operands[0]?.value === '' ? operands.slice(1) : operands;
  return hasOption(options, SED_SCRIPTS) ? files : files.slice(1);
}

const lastPart = (value) => value.replace(/\/+$/, '').split('/').pop();
const joinWord = (folder, name) => ({
  type: 'word',
  value: `${folder.value.replace(/\/+$/, '')}/${lastPart(name.value)}`,
  dynamic: folder.dynamic || name.dynamic,
});

// The links `ln` or `cp -l`/`cp -s` makes. Each hard link gives its source; each symbolic link gives where it is
// made (`at`; `maybeFolder` when that may be an existing folder, the link then being made inside it) and what it
// points to. A relative symbolic link points from its own folder, or from the working folder with `ln -r`.
function links(command, options, operands, targetDirectory) {
  const symbolic = hasOption(options, command === 'ln' ? ['-s', '--symbolic'] : ['-s', '--symbolic-link']);
  const hard = command === 'ln' ? !symbolic : hasOption(options, ['-l', '--link']);
  if (!symbolic && !hard) return { hard: [], symbolic: [], made: [] };
  let made = [];
  let sources = operands;
  let placed;
  if (targetDirectory) {
    placed = operands.map((source) => ({ at: joinWord(targetDirectory, source), source, maybeFolder: false }));
  } else if (operands.length === 1 && command === 'ln') {
    const at = { type: 'word', value: lastPart(operands[0].value), dynamic: operands[0].dynamic };
    made = [at];
    placed = [{ at, source: operands[0], maybeFolder: false }];
  } else if (operands.length >= 2) {
    const last = operands[operands.length - 1];
    sources = operands.slice(0, -1);
    const single = sources.length === 1 && !hasOption(options, ['-T', '--no-target-directory']);
    placed = sources.map((source) => (single
      ? { at: last, source, maybeFolder: true }
      : { at: joinWord(last, source), source, maybeFolder: false }));
  } else {
    return { hard: [], symbolic: [], made: [] };
  }
  if (hard) return { hard: sources, symbolic: [], made };
  const fromWorkingFolder = command === 'ln' && hasOption(options, ['-r', '--relative']);
  return { hard: [], symbolic: placed.map((link) => ({ ...link, fromWorkingFolder })), made };
}

// `find`'s options before its starting points, and the ones among them that take a value.
const FIND_LEADING = Object.freeze(['-H', '-L', '-P']);
// Actions that run a command up to `;` (or `{} +`); the `dir` ones run it in each file's folder.
const FIND_RUNS = Object.freeze(['-exec', '-execdir', '-ok', '-okdir']);
const FIND_OWN_FOLDER = Object.freeze(['-execdir', '-okdir']);
// Actions that write a file, and how many words each takes (`-fprintf FILE FORMAT`).
const FIND_WRITES = Object.freeze({ '-fprint': 1, '-fprint0': 1, '-fls': 1, '-fprintf': 2 });
const isFindExpression = (word) => (word.value.startsWith('-') && word.value.length > 1) || ['(', ')', '!', ','].includes(word.value);
const dot = Object.freeze({ type: 'word', value: '.', dynamic: false });

// The command words of a `find` action with `{}` replaced by a starting point, marked `fromStart`: every file `find`
// hands the command is under that point, so it is judged where the point is, from `find`'s own folder.
const withStart = (words, point) =>
  words.map((word) =>
    !word.dynamic && word.value.includes('{}')
      ? { type: 'word', value: word.value.replaceAll('{}', point.value), dynamic: point.dynamic, fromStart: true }
      : word);

/**
 * What `find` writes and runs: the file of `-fprint`, `-fprint0`, `-fprintf` and `-fls`, its starting points with
 * `-delete` (`.` when none is given), and the commands of `-exec`, `-execdir`, `-ok` and `-okdir`, one run per
 * starting point, `ownFolder` when the command runs in each file's folder.
 */
function findEffects(args) {
  let i = 0;
  while (i < args.length && (FIND_LEADING.includes(args[i].value) || /^-O\d*$/.test(args[i].value) || args[i].value === '-D')) {
    i += args[i].value === '-D' ? 2 : 1;
  }
  const given = [];
  while (i < args.length && !isFindExpression(args[i])) given.push(args[i++]);
  const points = given.length > 0 ? given : [dot];
  const targets = [];
  const runs = [];
  let deletes = false;
  while (i < args.length) {
    const action = args[i].value;
    if (FIND_RUNS.includes(action)) {
      let end = i + 1;
      while (end < args.length && args[end].value !== ';' && !(args[end].value === '+' && args[end - 1].value === '{}')) end += 1;
      const words = args.slice(i + 1, end);
      runs.push(...points.map((point) => ({ words: withStart(words, point), ownFolder: FIND_OWN_FOLDER.includes(action) })));
      i = end + 1;
    } else if (Object.hasOwn(FIND_WRITES, action)) {
      if (args[i + 1]) targets.push(args[i + 1]);
      i += 1 + FIND_WRITES[action];
    } else {
      if (action === '-delete') deletes = true;
      i += 1;
    }
  }
  return { targets: deletes ? [...targets, ...points] : targets, runs };
}

/**
 * What one simple command (prefix already stripped) writes: `targets` (files written), `ownLinks` (the names of the
 * symbolic links it makes, judged without following them), `hard` (the sources of the hard links it makes),
 * `symbolic` (the symbolic links it makes) and `runs` (the commands it runs itself, as `find -exec` does).
 */
export function commandEffects(words) {
  const none = { targets: [], ownLinks: [], hard: [], symbolic: [], runs: [] };
  const [name, ...args] = words;
  if (!name) return none;
  const command = commandName(name);
  if (command === 'sed') return { ...none, targets: sedTargets(args) };
  if (command === 'find') return { ...none, ...findEffects(args) };
  const { options, operands } = parseArgs(args, { values: VALUE_OPTIONS[command] ?? [] });
  if (ALL_ARGS.includes(command)) return { ...none, targets: operands };
  if (!LAST_ARG.includes(command)) return none;
  const targetDirectory = options.find((option) => TARGET_DIRECTORY.includes(option.name) && option.value)?.value;
  const made = command === 'ln' || command === 'cp' ? links(command, options, operands, targetDirectory) : undefined;
  let targets = [];
  if (targetDirectory) targets = [targetDirectory];
  else if (command === 'install' && hasOption(options, ['-d', '--directory'])) targets = operands;
  else if (operands.length >= 2) targets = [operands[operands.length - 1]];
  if (!made || made.symbolic.length === 0) return { ...none, targets: [...targets, ...(made?.made ?? [])], hard: made?.hard ?? [] };
  return { ...none, ownLinks: [...targets, ...made.made], symbolic: made.symbolic };
}

/**
 * The command line a command hands to the shell, when it names one as literal text: `{ line, sameShell }` for
 * `eval …` (it runs in this shell) and `sh -c …` (a new shell); `{ line: undefined }` when the line is not literal;
 * undefined for any other command.
 */
export function shellLine(words) {
  const [name, ...args] = words;
  if (!name) return undefined;
  const command = commandName(name);
  if (command === 'eval') {
    const literal = args.every((word) => !word.dynamic);
    return { line: literal ? args.map((word) => word.value).join(' ') : undefined, sameShell: true };
  }
  if (!SHELLS.includes(command)) return undefined;
  let runs = false;
  let i = 0;
  for (; i < args.length; i += 1) {
    const text = args[i].value;
    if (text === '--' || text === '-') {
      i += 1;
      break;
    }
    if (!/^[-+]/.test(text)) break;
    if (SHELL_VALUES.includes(text)) i += 1;
    else if (/^-[A-Za-z]+$/.test(text) && text.includes('c')) runs = true;
  }
  if (!runs) return undefined;
  const line = args[i];
  if (!line) return undefined;
  return { line: line.dynamic ? undefined : line.value, sameShell: false };
}
