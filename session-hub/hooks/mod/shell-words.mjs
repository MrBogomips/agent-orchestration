// A small POSIX-shell lexer, enough for best-effort checks on a command line: words with their quoting removed,
// and the control and redirection operators as separate tokens. It does not expand anything; a word that holds an
// unquoted or double-quoted `$`, a backtick, or an unquoted glob character is flagged `dynamic`.

const OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '(', ')'];
const REDIRECT = /^(\d*|&)(>>|>\||>)/;

/**
 * @param {string} line
 * @returns {Array<{ type: 'word', value: string, dynamic: boolean } | { type: 'op', value: string }
 *   | { type: 'redirect', value: string, fd: string }>}
 * @throws {Error} on an unbalanced quote
 */
export function tokenize(line) {
  const tokens = [];
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
    if (c === ' ' || c === '\t' || c === '\n') {
      endWord();
      if (c === '\n') tokens.push({ type: 'op', value: ';' });
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
    const rest = line.slice(i);
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
        // `>&2`: a duplication of a descriptor, kept as one word starting with `&`.
        startWord();
        word.value += '&';
        i += 1;
      }
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
