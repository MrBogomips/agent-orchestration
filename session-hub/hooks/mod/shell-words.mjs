// A small shell lexer for best-effort checks on a command line, read as bash or zsh: words with their quoting
// removed, and the control and redirection operators as separate tokens. It does not expand anything; a word that
// holds an expansion (`$name`, `${…}`, a substitution, arithmetic) or an unquoted glob character is flagged `dynamic`,
// a word with an unquoted brace `braces` (brace expansion is left to the caller), a word that starts with an unquoted
// `=` `equals` (zsh replaces `=name` with the path of a command).
//
// The commands inside a word's substitutions (`$(…)`, backticks, `<(…)`, `>(…)`, also inside double quotes, `${…}`
// and arithmetic) are lexed too and kept on the word as `subs`, one token list each. A here-document's `<<` and
// delimiter give no token; its body is data when the delimiter is quoted (`<<'EOF'`, `<<"EOF"`, `<<\EOF`), and
// otherwise its substitutions come as `subst` tokens after the line that opened it. `<<` inside arithmetic
// (`$((…))`, `((…))`, `$[…]`) and inside an array subscript (`a[1<<2]=3`) is a shift. An input redirection (`<`,
// `<<<`) is an `op` token `<` followed by the word it reads.
//
// It throws when it cannot read the line the way the shell would: an unbalanced quote, `$(`, `${` or backtick, a
// here-document whose delimiter never comes, an arithmetic expansion without its `))`, nesting deeper than it reads.

const OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '(', ')'];
// Output redirections: bash's, `<>` (read and write), and zsh's forms that write over noclobber (`>!`, `>>!`, `>>|`)
// or send both streams to a file (`>&|`, `>&!`, `>>&|`, `>>&!`).
const REDIRECT = /^(\d*|&)(<>|>>&!|>>&\||>&!|>&\||>>!|>>\||>>|>\||>!|>)/;
const HEREDOC = /^<<(-?)[ \t]*/;
const DESCRIPTOR = /^(\d+|-)(?=$|[\s;&|()<>])/;
const WORD_END = /[\s;&|()<>]/;
// What may follow `$` to make an expansion; any other `$` is a literal character.
const EXPANSION_START = /[A-Za-z_0-9{(@*#?$!-]/;
// Words after which a new command starts, as after an operator.
const COMMAND_WORDS = Object.freeze(['if', 'then', 'elif', 'else', 'while', 'until', 'do', '!', '{', '}', 'time', 'always']);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*(\[.*\])?\+?=/;
const MAX_DEPTH = 32;
const MAX_NESTING = 100;

const ANSI_ESCAPES = Object.freeze({
  a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
  '\\': '\\', "'": "'", '"': '"', '?': '?',
});

// Decodes the body of `$'…'` starting at `start` (after the quote). Returns the text and where it ends.
function readAnsi(src, start) {
  let value = '';
  let i = start;
  while (i < src.length && src[i] !== "'") {
    if (src[i] !== '\\' || i + 1 >= src.length) {
      value += src[i];
      i += 1;
      continue;
    }
    const c = src[i + 1];
    const hex = { x: 2, u: 4, U: 8 }[c];
    const octal = src.slice(i + 1).match(/^[0-7]{1,3}/);
    if (Object.hasOwn(ANSI_ESCAPES, c)) {
      value += ANSI_ESCAPES[c];
      i += 2;
    } else if (hex) {
      const digits = src.slice(i + 2).match(new RegExp(`^[0-9A-Fa-f]{1,${hex}}`));
      value += digits ? String.fromCodePoint(parseInt(digits[0], 16)) : `\\${c}`;
      i += 2 + (digits ? digits[0].length : 0);
    } else if (octal) {
      value += String.fromCharCode(parseInt(octal[0], 8));
      i += 1 + octal[0].length;
    } else if (c === 'c' && i + 2 < src.length) {
      value += String.fromCharCode(src.charCodeAt(i + 2) & 0x1f);
      i += 3;
    } else {
      value += `\\${c}`;
      i += 2;
    }
  }
  if (i >= src.length) throw new Error("unbalanced $' quote");
  return { value, end: i + 1 };
}

// Reads a here-document delimiter at `start`; quotes are removed. Returns the delimiter, whether any part of it was
// quoted (then the body is data), and where it ends.
function readDelimiter(src, start) {
  let i = start;
  let delimiter = '';
  let quoted = false;
  while (i < src.length && !WORD_END.test(src[i])) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new Error(`unbalanced ${c === "'" ? 'single' : 'double'} quote`);
      delimiter += src.slice(i + 1, end);
      quoted = true;
      i = end + 1;
    } else if (c === '\\' && i + 1 < src.length) {
      delimiter += src[i + 1];
      quoted = true;
      i += 2;
    } else {
      delimiter += c;
      i += 1;
    }
  }
  if (delimiter === '') throw new Error('a here-document without a delimiter');
  return { delimiter, quoted, end: i };
}

/**
 * @typedef {{ type: 'word', value: string, dynamic: boolean, descriptor?: true, braces?: true, equals?: true,
 *   subs?: Token[][] } | { type: 'op', value: string } | { type: 'redirect', value: string, fd: string }
 *   | { type: 'subst', tokens: Token[] }} Token
 */

// One source string being lexed: its text, the here-documents waiting for the next newline, how deep the nesting
// goes (shared by every source of one command line), and the substitutions already lexed, by where they start.
const context = (src, depth, budget = { nesting: 0 }) => {
  if (depth > MAX_DEPTH) throw new Error('substitutions nested too deeply');
  return { src, depth, budget, pending: [], memo: new Map() };
};

// Runs `read` one nesting level deeper; a substitution, once lexed at a place, is not lexed again (a failed
// arithmetic is lexed again as a command substitution, and nested ones would otherwise cost twice per level).
function nested(ctx, key, read) {
  const clean = ctx.pending.length === 0;
  if (clean && ctx.memo.has(key)) return ctx.memo.get(key);
  ctx.budget.nesting += 1;
  try {
    if (ctx.budget.nesting > MAX_NESTING) throw new Error('substitutions nested too deeply');
    const result = read();
    if (clean && ctx.pending.length === 0) ctx.memo.set(key, result);
    return result;
  } finally {
    ctx.budget.nesting -= 1;
  }
}

// Reads the bodies of the pending here-documents, starting at `start` (the line after the newline). Returns the
// `subst` tokens of the bodies that are not data, and the index after the last delimiter line.
function readBodies(ctx, start) {
  const found = [];
  let i = start;
  for (const { delimiter, stripTabs, quoted } of ctx.pending) {
    const lines = [];
    for (;;) {
      if (i >= ctx.src.length) throw new Error(`unterminated here-document: its delimiter ${delimiter} never comes`);
      const end = ctx.src.indexOf('\n', i);
      const text = ctx.src.slice(i, end < 0 ? ctx.src.length : end);
      i = end < 0 ? ctx.src.length : end + 1;
      if ((stripTabs ? text.replace(/^\t+/, '') : text) === delimiter) break;
      lines.push(text);
    }
    if (!quoted) {
      const body = context(lines.join('\n'), ctx.depth + 1, ctx.budget);
      const subs = [];
      scanQuoted(body, 0, { terminator: null, subs });
      found.push(...subs.map((tokens) => ({ type: 'subst', tokens })));
    }
  }
  ctx.pending = [];
  return { tokens: found, end: i };
}

// Backtick substitution starting at `start` (after the backtick): the body, with `\``, `\\` and `\$` unescaped (and
// `\"` inside double quotes), lexed as a command line of its own. Returns its tokens and where it ends.
function readBackticks(ctx, start, inDouble) {
  let body = '';
  let i = start;
  for (; i < ctx.src.length && ctx.src[i] !== '`'; i += 1) {
    const next = ctx.src[i + 1];
    if (ctx.src[i] === '\\' && next !== undefined && ('`\\$'.includes(next) || (inDouble && next === '"'))) {
      body += next;
      i += 1;
    } else {
      body += ctx.src[i];
    }
  }
  if (i >= ctx.src.length) throw new Error('unbalanced backquote');
  const tokens = nested(ctx, `\`${start}`, () => lexAll(context(body, ctx.depth + 1, ctx.budget)));
  return { tokens, end: i + 1 };
}

// Reads one expansion that starts with `$` or a backtick at `i` (in a word, in double quotes, in a here-document
// body). Adds the commands it holds to `subs`. Returns where it ends, or -1 when there is no expansion at `i`.
function readExpansion(ctx, i, subs, inDouble) {
  const src = ctx.src;
  if (src[i] === '`') {
    const { tokens, end } = readBackticks(ctx, i + 1, inDouble);
    subs.push(tokens);
    return end;
  }
  if (src[i] !== '$') return -1;
  if (src.startsWith('$((', i)) {
    const arithmetic = readArithmetic(ctx, i + 3);
    if (arithmetic.end >= 0) {
      subs.push(...arithmetic.subs);
      return arithmetic.end;
    }
  }
  if (src[i + 1] === '(') {
    const { tokens, end } = lexList(ctx, i + 2, true);
    subs.push(tokens);
    return end;
  }
  if (src[i + 1] === '[') return readBracket(ctx, i + 2, subs);
  if (src[i + 1] === '{') return readBraces(ctx, i + 2, subs, inDouble);
  return -1;
}

// Text in double quotes (terminator `"`) or a here-document body (no terminator) from `start`: backslash escapes and
// the expansions in it. Returns the text, whether it holds an expansion, and where it ends.
function scanQuoted(ctx, start, { terminator, subs }) {
  const src = ctx.src;
  let value = '';
  let dynamic = false;
  let i = start;
  while (i < src.length && src[i] !== terminator) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      const next = src[i + 1];
      if (next === '\n') {
        // a line continuation: both characters go
      } else if ('$`\\'.includes(next) || next === terminator) value += next;
      else value += `\\${next}`;
      i += 2;
      continue;
    }
    const end = readExpansion(ctx, i, subs, terminator !== null);
    if (end >= 0) {
      value += src.slice(i, end);
      dynamic = true;
      i = end;
      continue;
    }
    if (c === '$' && EXPANSION_START.test(src[i + 1] ?? '')) dynamic = true;
    value += c;
    i += 1;
  }
  if (terminator !== null && i >= src.length) throw new Error('unbalanced double quote');
  return { value, dynamic, end: terminator === null ? i : i + 1 };
}

// `${…}` from `start` (after the brace), with the expansions and quotes inside it. Returns where it ends.
function readBraces(ctx, start, subs, inDouble) {
  const found = nested(ctx, `{${start}${inDouble ? '"' : ''}`, () => {
    const src = ctx.src;
    const inner = [];
    let depth = 1;
    let i = start;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      const end = readExpansion(ctx, i, inner, inDouble);
      if (end >= 0) {
        i = end;
      } else if (c === '"') {
        i = scanQuoted(ctx, i + 1, { terminator: '"', subs: inner }).end;
      } else if (c === "'" && !inDouble) {
        const close = src.indexOf("'", i + 1);
        if (close < 0) throw new Error('unbalanced single quote');
        i = close + 1;
      } else {
        if (c === '{') depth += 1;
        if (c === '}') depth -= 1;
        i += 1;
        if (depth === 0) return { end: i, subs: inner };
      }
    }
    throw new Error('unbalanced ${');
  });
  subs.push(...found.subs);
  return found.end;
}

// Arithmetic from `start` (after `$((` or `((`), with the expansions inside it. Returns the index after its `))`
// and the commands inside, or end -1 when a lone `)` shows it is not arithmetic (`$((cmd) )` is a substitution
// holding a subshell).
function readArithmetic(ctx, start) {
  return nested(ctx, `(${start}`, () => {
    const src = ctx.src;
    const subs = [];
    let depth = 0;
    let i = start;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      const end = readExpansion(ctx, i, subs, false);
      if (end >= 0) {
        i = end;
      } else if (c === '"') {
        i = scanQuoted(ctx, i + 1, { terminator: '"', subs }).end;
      } else if (c === '(') {
        depth += 1;
        i += 1;
      } else if (c === ')') {
        if (depth > 0) depth -= 1;
        else return { end: src[i + 1] === ')' ? i + 2 : -1, subs };
        i += 1;
      } else {
        i += 1;
      }
    }
    throw new Error('unterminated arithmetic: a (( without its ))');
  });
}

// `$[…]` arithmetic or an array subscript, from `start` (after the `[`), with the expansions inside it. Returns the
// index after its `]`.
function readBracket(ctx, start, subs) {
  const found = nested(ctx, `[${start}`, () => {
    const src = ctx.src;
    const inner = [];
    let depth = 1;
    let i = start;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      const end = readExpansion(ctx, i, inner, false);
      if (end >= 0) {
        i = end;
      } else if (c === '"') {
        i = scanQuoted(ctx, i + 1, { terminator: '"', subs: inner }).end;
      } else if (c === "'") {
        const close = src.indexOf("'", i + 1);
        if (close < 0) throw new Error('unbalanced single quote');
        i = close + 1;
      } else {
        if (c === '[') depth += 1;
        if (c === ']') depth -= 1;
        i += 1;
        if (depth === 0) return { end: i, subs: inner };
      }
    }
    throw new Error('unbalanced [: an arithmetic or a subscript without its ]');
  });
  subs.push(...found.subs);
  return found.end;
}

const lexAll = (ctx) => {
  const { tokens } = lexList(ctx, 0, false);
  if (ctx.pending.length > 0) {
    throw new Error(`unterminated here-document: its delimiter ${ctx.pending[0].delimiter} never comes`);
  }
  return tokens;
};

// Lexes from `start` to the end of the source, or, with `closing`, to the `)` that closes a `$(` or `<(`. Returns
// the tokens and the index after where it stopped.
function lexList(ctx, start, closing) {
  if (closing) return nested(ctx, `$${start}`, () => lexTokens(ctx, start, true));
  return lexTokens(ctx, start, false);
}

function lexTokens(ctx, start, closing) {
  const src = ctx.src;
  const tokens = [];
  let i = start;
  let word = null;
  let wordAtCommand = false;
  let depth = 0;
  let cases = 0;
  // Where a command may start: at the beginning, after an operator, a reserved word or an assignment.
  const commandPosition = () => {
    const last = tokens[tokens.length - 1];
    if (last === undefined || last.type === 'op') return true;
    return last.type === 'word' && !last.dynamic && (COMMAND_WORDS.includes(last.value) || ASSIGNMENT_WORD.test(last.value));
  };
  const startWord = () => {
    if (word === null) {
      wordAtCommand = commandPosition();
      word = { type: 'word', value: '', dynamic: false };
    }
    return word;
  };
  const addSubs = (subs) => {
    const target = startWord();
    target.dynamic = true;
    if (subs.length > 0) target.subs = [...(target.subs ?? []), ...subs];
  };
  // A `case` keeps count so that the `)` after each of its patterns does not close a `$(`.
  const endWord = () => {
    if (word === null) return;
    if (wordAtCommand && word.value === 'case' && !word.dynamic) cases += 1;
    else if (word.value === 'esac' && !word.dynamic && cases > 0) cases -= 1;
    tokens.push(word);
    word = null;
  };
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    if (c === '\\' && src[i + 1] === '\n') {
      i += 2; // a line continuation joins the two lines
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n') {
      endWord();
      i += 1;
      if (c === '\n') {
        tokens.push({ type: 'op', value: ';' });
        if (ctx.pending.length > 0) {
          const bodies = readBodies(ctx, i);
          tokens.push(...bodies.tokens);
          i = bodies.end;
        }
      }
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new Error('unbalanced single quote');
      startWord().value += src.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (rest.startsWith("$'")) {
      const { value, end } = readAnsi(src, i + 2);
      startWord().value += value;
      i = end;
      continue;
    }
    if (c === '"' || rest.startsWith('$"')) {
      const subs = [];
      const quoted = scanQuoted(ctx, i + (c === '"' ? 1 : 2), { terminator: '"', subs });
      startWord().value += quoted.value;
      if (quoted.dynamic) addSubs(subs);
      i = quoted.end;
      continue;
    }
    if (c === '\\' && i + 1 < src.length) {
      startWord().value += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '#' && word === null) {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    const subs = [];
    const expansion = readExpansion(ctx, i, subs, false);
    if (expansion >= 0) {
      startWord().value += src.slice(i, expansion);
      addSubs(subs);
      i = expansion;
      continue;
    }
    if (rest.startsWith('<(') || rest.startsWith('>(')) {
      const { tokens: inner, end } = lexList(ctx, i + 2, true);
      startWord().value += src.slice(i, end);
      addSubs([inner]);
      i = end;
      continue;
    }
    // `a[1<<2]=3`: a subscript in an assignment is arithmetic.
    if (c === '[' && word !== null && wordAtCommand && !word.dynamic && NAME.test(word.value)) {
      const end = readBracket(ctx, i + 1, subs);
      word.value += src.slice(i, end);
      if (subs.length > 0) addSubs(subs);
      i = end;
      continue;
    }
    const last = tokens[tokens.length - 1];
    if (rest.startsWith('((') && word === null && (commandPosition() || (last?.type === 'word' && last.value === 'for'))) {
      const arithmetic = readArithmetic(ctx, i + 2);
      if (arithmetic.end >= 0) {
        const found = arithmetic.subs;
        tokens.push({ type: 'word', value: src.slice(i, arithmetic.end), dynamic: true, ...(found.length > 0 ? { subs: found } : {}) });
        i = arithmetic.end;
        continue;
      }
    }
    const redirect = rest.match(REDIRECT);
    if (redirect) {
      let fd = redirect[1];
      if (word !== null && !word.dynamic && /^\d+$/.test(word.value) && fd === '') {
        fd = word.value;
        word = null;
      }
      endWord();
      tokens.push({ type: 'redirect', value: redirect[2], fd });
      i += redirect[0].length;
      if (src[i] === '&') {
        const descriptor = src.slice(i + 1).match(DESCRIPTOR);
        if (descriptor) {
          // `>&2`, `>&-`: a duplication or a close, not a file.
          tokens.push({ type: 'word', value: `&${descriptor[1]}`, dynamic: false, descriptor: true });
          i += 1 + descriptor[1].length;
        } else {
          i += 1; // `>& file`: both streams to the file, which is the next word
        }
      }
      continue;
    }
    if (rest.startsWith('<<<')) {
      endWord();
      tokens.push({ type: 'op', value: '<' });
      i += 3;
      continue;
    }
    const heredoc = rest.match(HEREDOC);
    if (heredoc) {
      endWord();
      const { delimiter, quoted, end } = readDelimiter(src, i + heredoc[0].length);
      ctx.pending = [...ctx.pending, { delimiter, quoted, stripTabs: heredoc[1] === '-' }];
      i = end;
      continue;
    }
    if (c === '<') {
      endWord();
      tokens.push({ type: 'op', value: '<' });
      i += 1;
      continue;
    }
    const op = OPERATORS.find((candidate) => rest.startsWith(candidate));
    if (op) {
      endWord();
      i += op.length;
      if (op === ')' && closing && depth === 0 && cases === 0) return { tokens, end: i };
      if (op === '(') depth += 1;
      if (op === ')' && depth > 0) depth -= 1;
      tokens.push({ type: 'op', value: op });
      continue;
    }
    const fresh = word === null;
    const plain = startWord();
    if (c === '*' || c === '?' || c === '[' || (c === '$' && EXPANSION_START.test(src[i + 1] ?? ''))) plain.dynamic = true;
    if (c === '{' || c === '}') plain.braces = true;
    if (fresh && c === '=') plain.equals = true;
    plain.value += c;
    i += 1;
  }
  endWord();
  if (closing) throw new Error('unbalanced parenthesis: a $( or <( without its )');
  return { tokens, end: i };
}

/**
 * @param {string} line
 * @returns {Token[]}
 * @throws {Error} on a line it cannot read the way the shell would
 */
export function tokenize(line, depth = 0) {
  return lexAll(context(line, depth));
}
