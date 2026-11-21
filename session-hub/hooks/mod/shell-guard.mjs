// The shell check: a best-effort look at a child's shell command (Bash, Monitor) for files it would write outside
// the write root. Spike S10 showed a model write outside its root through the shell when nothing told it not to;
// the classic scope guard sees only Edit, Write and NotebookEdit.
//
// Best effort, by design. The command is read as bash or zsh (the Bash tool runs zsh on macOS). It reads
// redirections (zsh's `>!` and `>>!` and `<>` included) and the targets of common file-writing commands (tee, touch,
// mkdir, rm, rmdir, truncate, unlink, cp, mv, ln, install, sed -i), behind assignments, wrappers (sudo, env, nice,
// timeout, xargs, command, nohup, time, builtin, exec, coproc, and zsh's noglob, nocorrect, -, repeat N and
// `=command`) and reserved words (if, then, elif, else, while, until, do, !, {, function). It reads the commands in
// substitutions (`$(…)`, backticks, `<(…)`, also inside double quotes, `${…}`, arithmetic and here-documents whose
// delimiter is not quoted) and in a literal line given to `eval` or to `sh`, `bash`, `zsh`, `dash` or `ksh -c`.
// It follows the working folder through `cd` and `pushd` to a literal folder (absolute, `~`, `~/…`, or relative to
// a known folder), so a later relative target is judged where it lands. It judges the source of a hard link
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
// a path it cannot resolve (`~` without HOME, `~user`, a relative path without a working folder, a link that leads
// nowhere, a link this command makes to a place it cannot know).

import { commandEffects, commandName, parseArgs, hasOption, shellLine, stripPrefix } from './shell-commands.mjs';
import { tokenize } from './shell-words.mjs';
import { checkRootFolder, checkRootSetting } from './write-root.mjs';

const PREFIX = '[session-hub]';
const ALLOW = Object.freeze({ allow: true });
const ALLOWED_ROOTS = Object.freeze(['/dev', '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']);
const DIRECTORY_CHANGES = Object.freeze(['cd', 'pushd', 'popd']);
const MAX_DEPTH = 32;
const MAX_LINK_HOPS = 40;

const advice =
  'Do not retry this write through another command or tool. Send an `out-of-scope` message to the master, saying ' +
  'what you need written and why, and tell the user that you passed the request to the master.';

// The folders the shell may be in, as a list: a path, UNKNOWN (a change of folder that cannot be known without
// running the shell) or MISSING (no working folder was given).
const UNKNOWN = Symbol('unknown folder');
const MISSING = Symbol('missing folder');
const unique = (list) => [...new Set(list)];

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
// holds for the rest of the list, not outside a subshell `( … )`, a substitution, a pipeline or a background job.
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
  const finish = () => {
    const { words, changesDirectory } = stripPrefix(current.words);
    const dirs = changesDirectory ? [UNKNOWN] : state.dirs;
    const effects = commandEffects(words);
    const add = (kind, list) => env.out[kind].push(...list.map((word) => ({ word, dirs })));
    add('targets', [...current.redirects.filter((word) => !word.descriptor), ...effects.targets]);
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
      state = { dirs: changeFolder(words, state.dirs, env.home), fallback: unique([...state.fallback, ...state.dirs]) };
    }
    current = { words: [], redirects: [] };
  };
  const endPipeline = () => {
    if (piped) state = pipeline;
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
      } else if (token.value !== '&&') state = { dirs: unique([...state.dirs, ...state.fallback]), fallback: [] };
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

// The absolute forms of a target, `..` still in them, one per folder it may be relative to; none when it cannot be
// known without running the shell (a variable, a substitution, a glob, a relative path after a change of folder
// that cannot be known). Throws when it names a place that cannot be resolved here.
function absoluteTargets(word, dirs, home) {
  if (word.dynamic || word.value === '') return [];
  let value = word.value;
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
function lander(links, realpath) {
  const land = async (path, except, hops = 0) => {
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
      for (const real of await land(path, ownLink ? path : undefined)) {
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
