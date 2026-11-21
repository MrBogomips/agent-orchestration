// The shell check: a best-effort look at a child's shell command (Bash, Monitor) for files it would write outside
// the write root. Spike S10 showed a model write outside its root through the shell when nothing told it not to;
// the classic scope guard sees only Edit, Write and NotebookEdit.
//
// Best effort, by design. The command is read as bash or zsh (the Bash tool runs zsh on macOS). It reads
// redirections (zsh's `>!` and `>>!` and `<>` included) and the targets of common file-writing commands (tee, touch,
// mkdir, rm, rmdir, truncate, unlink, cp, mv, ln, install, sed -i), behind assignments, wrappers (sudo, env, nice,
// timeout, xargs, command, nohup, time, builtin, exec, coproc, env -S, and zsh's noglob, nocorrect, -, repeat N and
// `=command`) and reserved words (if, then, elif, else, while, until, do, !, {, }, function, zsh's always). It reads
// the commands in substitutions (`$(…)`, backticks, `<(…)`, also inside double quotes, `${…}`, arithmetic and
// here-documents whose delimiter is not quoted) and in a literal line given to `eval` or to `sh`, `bash`, `zsh`,
// `dash` or `ksh -c`. A target with braces is judged in every word its brace expansion gives.
// It follows the working folder through `cd`, `chdir` and `pushd` to a literal folder (absolute, `~`, `~/…`, or
// relative to a known folder), so a later relative target is judged where it lands; a change of folder in the last
// part of a pipeline may hold after it (zsh runs that part in the shell). It judges the source of a hard link
// (`ln`, `cp -l`), and a write that goes through a symbolic link the same command makes (`ln -s`, `cp -s`).
// It does not judge targets it cannot know without running the shell (a variable, a command substitution, a glob, a
// relative path after a `cd` to such a target, `cd -`, `popd`, or a wrapper's change of folder, a line given to
// `eval` or `sh -c` that is not literal), nor CDPATH, nor writes made by any other program. Writes under /dev and the
// system temporary folders are allowed, judged on the resolved path.
//
// `..` is resolved the way the kernel does: against where the part before it really lands (symbolic links
// followed), not by removing the previous name, so `link/../x` is judged where it lands and `../sibling` keeps
// working.
//
// It fails closed when it cannot evaluate a command it found targets in: no write root, a write root the classic
// scope guard would refuse too (see write-root.mjs), an unknown role, a command it cannot read (see shell-words.mjs),
// a path it cannot resolve (`~` without HOME, `~user`, zsh's `=name`, a relative path without a working folder, a
// link that leads nowhere, a link this command makes to a place it cannot know), or a command that would cost too much
// to follow (more than 64 possible folders, a brace expansion of more than 256 words).

import { commandEffects, commandName, parseArgs, hasOption, shellLine, stripPrefix } from './shell-commands.mjs';
import { tokenize } from './shell-words.mjs';
import { checkRootFolder, checkRootSetting, isRootSettings, settingsReason } from './write-root.mjs';

const PREFIX = '[session-hub]';
const ALLOW = Object.freeze({ allow: true });
const ALLOWED_ROOTS = Object.freeze(['/dev', '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']);
const DIRECTORY_CHANGES = Object.freeze(['cd', 'chdir', 'pushd', 'popd']);
const MAX_DEPTH = 32;
const MAX_LINK_HOPS = 40;
// How many folders the shell may be in, and how many words a brace expansion may give, before the check gives up.
const MAX_FOLDERS = 64;
const MAX_EXPANSIONS = 256;

const advice =
  'Do not retry this write through another command or tool. Send an `out-of-scope` message to the master, saying ' +
  'what you need written and why, and tell the user that you passed the request to the master.';

// The folders the shell may be in, as a list: a path, UNKNOWN (a change of folder that cannot be known without
// running the shell) or MISSING (no working folder was given).
const UNKNOWN = Symbol('unknown folder');
const MISSING = Symbol('missing folder');
const unique = (list) => [...new Set(list)];

// Each `cd` that may fail doubles the folders the shell may be in: past a bound, the check gives up (and denies).
const folders = (list) => {
  const found = unique(list);
  if (found.length > MAX_FOLDERS) throw new Error('too many folders the shell may be in after these changes of folder');
  return found;
};

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

// Expands a leading `~` or `~/`; undefined for `~user` or when HOME is not known.
function expandHome(value, home) {
  if (!value.startsWith('~')) return value;
  if (value !== '~' && !value.startsWith('~/')) return undefined;
  return home ? `${home}${value.slice(1)}` : undefined;
}

// Where a `cd` or `pushd` (`words` after the prefix) leaves the shell, from each folder it may be in. `cd` keeps
// `..` as the shell does by default (logically, removing the previous name); with `-P` the path is kept as written
// and `..` is folded later where the part before it really lands.
function changeFolder(words, dirs, home) {
  const [name, ...args] = words;
  if (commandName(name) === 'popd') return [UNKNOWN];
  const { options, operands } = parseArgs(args);
  if (operands.length > 1) return [UNKNOWN];
  if (operands.length === 0) {
    if (commandName(name) === 'pushd' || !home) return [UNKNOWN];
    return [normalizePath(home)];
  }
  const word = operands[0];
  if (word.dynamic || word.value === '' || word.value === '-' || /^[+-]\d+$/.test(word.value)) return [UNKNOWN];
  const target = expandHome(word.value, home);
  if (target === undefined) return [UNKNOWN];
  const physical = hasOption(options, ['-P']);
  const fold = (path) => (physical ? path : normalizePath(path));
  if (target.startsWith('/')) return [fold(target)];
  return unique(dirs.map((dir) => (typeof dir === 'string' ? fold(`${dir}/${target}`) : dir)));
}

const subshell = (state) => ({ dirs: state.dirs, fallback: [] });

// Walks a token list in the order the shell runs it, following the folder through `cd` and `pushd`: a change
// holds for the rest of the list, not outside a subshell `( … )`, a substitution, a pipeline (but its last part) or
// a background job.
// A change that may fail (anything other than `cd X && …`) leaves both folders possible from the next `;`, `||` or
// newline. Adds what it finds to `out`, each with the folders it may be relative to; returns the state at the end.
function walk(tokens, start, env) {
  if (env.depth > MAX_DEPTH) throw new Error('commands nested too deeply');
  const inner = (list, from) => walk(list, from, { ...env, depth: env.depth + 1 });
  let state = start;
  let pipeline = state;
  let piped = false;
  const stack = [];
  let current = { words: [], redirects: [] };
  // A word's substitutions run first, each in a subshell of the folder the shell is in.
  const visit = (token) => {
    for (const list of token?.subs ?? []) inner(list, subshell(state));
    return token;
  };
  // One simple command: what it writes, the line it hands to a shell, the folder it moves to.
  const simple = (prefixed) => {
    const { words, changesDirectory } = stripPrefix(prefixed);
    const dirs = changesDirectory ? [UNKNOWN] : state.dirs;
    const effects = commandEffects(words);
    const add = (kind, list) => env.out[kind].push(...list.map((word) => ({ word, dirs })));
    add('targets', effects.targets);
    add('ownLinks', effects.ownLinks);
    add('hard', effects.hard);
    env.out.symbolic.push(...effects.symbolic.map((link) => ({ ...link, dirs })));
    const handed = shellLine(words);
    if (handed?.line !== undefined) {
      const lexed = tokenize(handed.line, env.depth + 1);
      if (handed.sameShell) state = inner(lexed, state);
      else inner(lexed, { dirs, fallback: [] });
    }
    if (words[0] && DIRECTORY_CHANGES.includes(commandName(words[0]))) {
      state = { dirs: folders(changeFolder(words, state.dirs, env.home)), fallback: folders([...state.fallback, ...state.dirs]) };
    }
  };
  // The shell opens the redirections in its own folder. A `}` word ends a command too: zsh needs no `;` before it
  // (`{ true } always { … }`).
  const finish = () => {
    const redirects = current.redirects.filter((word) => !word.descriptor);
    env.out.targets.push(...redirects.map((word) => ({ word, dirs: state.dirs })));
    let segment = [];
    for (const word of current.words) {
      if (word.value === '}' && !word.dynamic && segment.length > 0) {
        simple(segment);
        segment = [];
      }
      segment.push(word);
    }
    simple(segment);
    current = { words: [], redirects: [] };
  };
  // Each part of a pipeline runs in a subshell, except, in zsh, the last one: a change of folder there may hold.
  const endPipeline = () => {
    if (piped) {
      state = { dirs: folders([...pipeline.dirs, ...state.dirs]), fallback: folders([...pipeline.fallback, ...state.fallback]) };
    }
    piped = false;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'subst') {
      inner(token.tokens, subshell(state));
    } else if (token.type === 'word') {
      current.words.push(visit(token));
    } else if (token.type === 'redirect') {
      if (tokens[i + 1]?.type === 'word') {
        current.redirects.push(visit(tokens[i + 1]));
        i += 1;
      }
    } else if (token.value === '<') {
      if (tokens[i + 1]?.type === 'word') {
        visit(tokens[i + 1]);
        i += 1; // the input file is read, not written
      }
    } else {
      finish();
      if (token.value === '|' || token.value === '|&') {
        state = pipeline; // each part of a pipeline runs in a subshell
        piped = true;
        continue;
      }
      endPipeline();
      if (token.value === '&') state = pipeline; // a background job runs in a subshell
      else if (token.value === '(') stack.push({ state, pipeline, piped });
      else if (token.value === ')') {
        if (stack.length > 0) ({ state, pipeline, piped } = stack.pop());
      } else if (token.value !== '&&') state = { dirs: folders([...state.dirs, ...state.fallback]), fallback: [] };
      if (token.value !== ')') pipeline = state;
    }
  }
  finish();
  endPipeline();
  return state;
}

function analyse(command, { cwd, home } = {}) {
  const out = { targets: [], ownLinks: [], hard: [], symbolic: [] };
  walk(tokenize(command), { dirs: [cwd ?? MISSING], fallback: [] }, { home, out, depth: 0 });
  return out;
}

/** The write targets a command line names, as written. Throws on a line it cannot parse. */
export function shellWriteTargets(command) {
  const { targets, ownLinks } = analyse(command);
  return [...targets, ...ownLinks].map(({ word }) => word.value);
}

const isUnder = (path, root) => path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
const isAllowedPlace = (path) => ALLOWED_ROOTS.some((root) => isUnder(path, root));

// The first brace pair of `text` that expands (`{a,b}`, `{1..3}`, `{a..c}`): where it opens and closes, and its words.
function firstBrace(text) {
  for (let open = text.indexOf('{'); open >= 0; open = text.indexOf('{', open + 1)) {
    let depth = 0;
    const commas = [];
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === ',' && depth === 1) commas.push(i);
      else if (text[i] === '}' && --depth === 0) {
        const inner = text.slice(open + 1, i);
        if (commas.length > 0) {
          const cuts = [open, ...commas, i];
          return { open, close: i, items: cuts.slice(1).map((cut, k) => text.slice(cuts[k] + 1, cut)) };
        }
        const numbers = inner.match(/^(-?\d+)\.\.(-?\d+)$/);
        const letters = inner.match(/^([A-Za-z])\.\.([A-Za-z])$/);
        const range = numbers ? [Number(numbers[1]), Number(numbers[2])] : letters && [letters[1].charCodeAt(0), letters[2].charCodeAt(0)];
        if (range && Math.abs(range[1] - range[0]) < MAX_EXPANSIONS) {
          const step = range[1] >= range[0] ? 1 : -1;
          const items = [];
          for (let n = range[0]; n !== range[1] + step; n += step) items.push(numbers ? String(n) : String.fromCharCode(n));
          return { open, close: i, items };
        }
        break;
      }
    }
  }
  return undefined;
}

// A word as written and every word its brace expansion may give.
function expandBraces(text) {
  const found = new Set([text]);
  const queue = [text];
  while (queue.length > 0) {
    const current = queue.pop();
    const brace = firstBrace(current);
    for (const item of brace?.items ?? []) {
      const next = `${current.slice(0, brace.open)}${item}${current.slice(brace.close + 1)}`;
      if (found.has(next)) continue;
      found.add(next);
      queue.push(next);
      if (found.size > MAX_EXPANSIONS) throw new Error(`cannot judge ${text}: its brace expansion gives too many words`);
    }
  }
  return [...found];
}

// The absolute forms of a target, `..` still in them, one per folder it may be relative to and per word of its brace
// expansion; none when it cannot be known without running the shell (a variable, a substitution, a glob, a relative
// path after a change of folder that cannot be known). Throws when it names a place that cannot be resolved here.
function absoluteTargets(word, dirs, home) {
  if (word.dynamic || word.value === '') return [];
  if (word.equals && word.value.length > 1) {
    throw new Error(`cannot resolve ${word.value}: zsh reads =name as the path of the command name`);
  }
  const values = word.braces ? expandBraces(word.value) : [word.value];
  return unique(values.flatMap((value) => absoluteForms(value, dirs, home)));
}

function absoluteForms(written, dirs, home) {
  let value = written;
  if (value.startsWith('~')) {
    const user = value.slice(1).split('/')[0];
    if (user !== '') throw new Error(`cannot resolve ${value}: another user's home folder`);
    if (!home) throw new Error(`cannot resolve ${value}: HOME is not set`);
    value = `${home}${value.slice(1)}`;
  }
  if (value.startsWith('/')) return [value];
  if (dirs.includes(UNKNOWN)) return [];
  if (dirs.includes(MISSING)) throw new Error(`cannot resolve ${value}: the working folder is unknown`);
  return dirs.map((dir) => `${dir}/${value}`);
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

// The symbolic links the command makes, as `{ at, to }` absolute paths (`at` folded, `to` folded when followed);
// `to` is undefined when where the link points cannot be known here.
async function madeLinks(symbolic, home, realpath) {
  const found = [];
  for (const link of symbolic) {
    for (const written of absoluteTargets(link.at, link.dirs, home)) {
      const at = await foldDots(written, realpath);
      const source = link.source;
      const places = link.maybeFolder ? [at, `${at === '/' ? '' : at}/${source.value.replace(/\/+$/, '').split('/').pop()}`] : [at];
      for (const place of unique(places)) {
        let to;
        if (!source.dynamic && source.value !== '') {
          const expanded = expandHome(source.value, home);
          if (expanded?.startsWith('/')) to = expanded;
          else if (expanded !== undefined && !link.fromWorkingFolder) to = `${parentOf(place)}/${expanded}`;
          else if (expanded !== undefined) {
            const from = absoluteTargets(source, link.dirs, home);
            to = from.length === 1 ? from[0] : undefined;
          }
        }
        found.push({ at: place, to });
      }
    }
  }
  return found;
}

// Where a path really lands, following the links the command makes (not yet on disk) and then `realpath`. A path
// may land in several places when two of those links share a name. `except` is a link the path is the name of.
// Each path is resolved once: links that share a name would otherwise double the work at every level.
function lander(made, realpath) {
  const links = [...new Map(made.map((link) => [`${link.at}\0${link.to}`, link])).values()];
  const known = new Map();
  const land = async (path, except, hops = 0) => {
    const key = `${except ?? ''}\0${path}`;
    if (!known.has(key)) known.set(key, await follow(path, except, hops));
    return known.get(key);
  };
  const follow = async (path, except, hops) => {
    const through = links.filter(({ at }) => at !== except && isUnder(path, at));
    if (through.length === 0) return [await realpath(path)];
    if (hops >= MAX_LINK_HOPS) throw new Error(`cannot resolve ${path}: too many links`);
    const landed = [];
    for (const { at, to } of through) {
      if (to === undefined) {
        throw new Error(`cannot resolve ${path}: it goes through a link this command makes to a place that cannot be known here`);
      }
      const next = await foldDots(`${to}${path.slice(at.length)}`, async (part) => (await land(part, undefined, hops + 1))[0]);
      landed.push(...(await land(next, undefined, hops + 1)));
    }
    return unique(landed);
  };
  return land;
}

async function writeRoot(role, { realpath, fileKind, home }) {
  if (role.kind === 'invalid') {
    throw new Error(`SESSION_HUB_ROLE has an unknown value (${role.raw}); expected child`);
  }
  const raw = checkRootSetting(role.scopeRoot);
  if (typeof fileKind !== 'function') throw new Error('there is no way to check that the write root is a folder');
  const real = await realpath(normalizePath(raw));
  const homeReal = home?.startsWith('/') ? await realpath(normalizePath(home)) : undefined;
  return checkRootFolder({ raw, real, kind: await fileKind(real), home: homeReal });
}

const block = (why) => Object.freeze({ allow: false, reason: `${PREFIX} Shell command blocked: ${why}` });

/**
 * @param {{ role: ReturnType<typeof import('./role.mjs').readRole>, command: string, cwd?: string, home?: string,
 *   realpath: (path: string) => Promise<string>, fileKind: (path: string) => Promise<'dir' | 'other' | 'missing'> }}
 *   input  `realpath` resolves symbolic links in the existing part; `fileKind` says what a path is
 * @returns {Promise<{ allow: true } | { allow: false, reason: string }>}
 */
export async function judgeShell({ role, command, cwd, home, realpath, fileKind }) {
  if (!role.guarding) return ALLOW;
  try {
    const found = analyse(String(command ?? ''), { cwd, home });
    const absolute = (list) => list.flatMap(({ word, dirs }) => absoluteTargets(word, dirs, home).map((path) => ({ path, word })));
    const checks = [
      ...absolute(found.targets).map((target) => ({ ...target, verb: 'writes' })),
      ...absolute(found.ownLinks).map((target) => ({ ...target, verb: 'writes', ownLink: true })),
      ...absolute(found.hard).map((target) => ({ ...target, verb: 'makes a hard link to' })),
    ];
    if (checks.length === 0) return ALLOW;
    const links = await madeLinks(found.symbolic, home, realpath);
    const land = lander(links, realpath);
    const follow = async (part) => (await land(part))[0];
    let root;
    for (const { path: written, verb, ownLink } of checks) {
      const path = await foldDots(written, follow);
      if (isUnder(path, '/dev')) continue;
      root ??= await writeRoot(role, { realpath, fileKind, home });
      const isWrite = verb === 'writes';
      if (isWrite && isRootSettings(path, normalizePath(role.scopeRoot))) return block(`${settingsReason(path)} ${advice}`);
      for (const real of await land(path, ownLink ? path : undefined)) {
        if (isWrite && isRootSettings(real, root)) return block(`${settingsReason(real)} ${advice}`);
        if (isUnder(real, root) || isAllowedPlace(real)) continue;
        const lands = real === path ? '' : ` (resolves to ${real})`;
        return block(`it ${verb} ${path}${lands}, outside the write root ${root}. ${advice}`);
      }
    }
    return ALLOW;
  } catch (error) {
    return block(
      `the session-hub shell check could not evaluate this command (${error?.message ?? error}). A guard that ` +
        'cannot evaluate does not let the call pass. Tell the user, and ask the master if the scope is wrong.',
    );
  }
}
