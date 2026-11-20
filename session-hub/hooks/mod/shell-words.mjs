// A small POSIX-shell lexer, enough for best-effort checks on a command line: words with their quoting removed,
// and the control and redirection operators as separate tokens. It does not expand anything; a word that holds an
// unquoted or double-quoted `$`, a backtick, or an unquoted glob character is flagged `dynamic`.
//
// A here-document's body is skipped (it is data, not commands); its `<<` and delimiter give no token. An input
// redirection (`<`, `<<<`) is an `op` token `<` followed by the word it reads.

const OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '(', ')'];
const REDIRECT = /^(\d*|&)(>>|>\||>)/;
const HEREDOC = /^<<(-?)[ \t]*/;
const DESCRIPTOR = /^(\d+|-)(?=$|[\s;&|()<>])/;
const WORD_END = /[\s;&|()<>]/;

// Reads a here-document delimiter at `start`; quotes are removed. Returns the delimiter and where it ends.
function readDelimiter(line, start) {
  let i = start;
  let delimiter = '';
  while (i < line.length && !WORD_END.test(line[i])) {
    const c = line[i];
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      if (end < 0) throw new Error(`unbalanced ${c === "'" ? 'single' : 'double'} quote`);
      delimiter += line.slice(i + 1, end);
      i = end + 1;
    } else if (c === '\\' && i + 1 < line.length) {
      delimiter += line[i + 1];
      i += 2;
    } else {
      delimiter += c;
      i += 1;
    }
  }
  if (delimiter === '') throw new Error('a here-document without a delimiter');
  return { delimiter, end: i };
}

// Skips the bodies of the pending here-documents, starting at the line after `newline`. Returns the next index.
function skipBodies(line, newline, pending) {
  let i = newline + 1;
  for (const { delimiter, stripTabs } of pending) {
    for (;;) {
      if (i >= line.length) return line.length;
      const end = line.indexOf('\n', i);
      const text = line.slice(i, end < 0 ? line.length : end);
      i = end < 0 ? line.length : end + 1;
      if ((stripTabs ? text.replace(/^\t+/, '') : text) === delimiter) break;
    }
  }
  return i;
}

/**
 * @param {string} line
 * @returns {Array<{ type: 'word', value: string, dynamic: boolean } | { type: 'op', value: string }
 *   | { type: 'redirect', value: string, fd: string }>}
 * @throws {Error} on an unbalanced quote
 */
export function tokenize(line) {
  const tokens = [];
  let pending = [];
  let i = 0;
  let word = null;
  const startWord = () => {
    if (word === null) word = { type: 'word', value: '', dynamic: false };
  };
  const endWord = () => {
    if (word !== null) tokens.push(word);
    word = null;
  };
  while (i < line.length) {
    const c = line[i];
    const rest = line.slice(i);
    if (c === '\\' && line[i + 1] === '\n') {
      i += 2; // a line continuation joins the two lines
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n') {
      endWord();
      if (c === '\n') {
        tokens.push({ type: 'op', value: ';' });
        if (pending.length > 0) {
          i = skipBodies(line, i, pending);
          pending = [];
          continue;
        }
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error('unbalanced single quote');
      startWord();
      word.value += line.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      startWord();
      let j = i + 1;
      for (; j < line.length && line[j] !== '"'; j += 1) {
        if (line[j] === '\\' && j + 1 < line.length) {
          j += 1;
        } else if (line[j] === '$' || line[j] === '`') {
          word.dynamic = true;
        }
        word.value += line[j];
      }
      if (j >= line.length) throw new Error('unbalanced double quote');
      i = j + 1;
      continue;
    }
    if (c === '\\' && i + 1 < line.length) {
      startWord();
      word.value += line[i + 1];
      i += 2;
      continue;
    }
    if (c === '#' && word === null) {
      const end = line.indexOf('\n', i);
      i = end < 0 ? line.length : end;
      continue;
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
      if (line[i] === '&') {
        const descriptor = line.slice(i + 1).match(DESCRIPTOR);
        if (descriptor) {
          // `>&2`, `>&-`: a duplication or a close, kept as one word starting with `&`.
          tokens.push({ type: 'word', value: `&${descriptor[1]}`, dynamic: false });
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
      const { delimiter, end } = readDelimiter(line, i + heredoc[0].length);
      pending = [...pending, { delimiter, stripTabs: heredoc[1] === '-' }];
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
      tokens.push({ type: 'op', value: op });
      i += op.length;
      continue;
    }
    startWord();
    if (c === '$' || c === '`' || c === '*' || c === '?' || c === '[') word.dynamic = true;
    word.value += c;
    i += 1;
  }
  endWord();
  return tokens;
}
