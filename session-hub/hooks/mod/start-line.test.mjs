import { test } from 'node:test';
import assert from 'node:assert/strict';

import { childStarts, startLineSegments, startLineText } from './start-line.mjs';

const ENV = 'SESSION_HUB_ROLE=child SESSION_HUB_MASTER=hub SESSION_HUB_SCOPE_ROOT=/h/product SESSION_HUB_HANDOFF=/h/t.md ' +
  'SESSION_HUB_REGISTRY=/r.json SESSION_HUB_GUARDS=on';

test('a claude --bg start, from the terminal form', () => {
  const command = `cd /h/product && env ${ENV} claude --bg -n t42-product --model opus --effort high --permission-mode acceptEdits -- "Read and follow /h/t.md"`;
  assert.deepEqual(childStarts(command), [{ name: 't42-product', model: 'opus', effort: 'high' }]);
});

test('a start without env, and options with =', () => {
  const command = `${ENV} claude --name=t1-api --model=claude-sonnet-5-5 --effort=low -- "Read and follow /h/t.md"`;
  assert.deepEqual(childStarts(command), [{ name: 't1-api', model: 'claude-sonnet-5-5', effort: 'low' }]);
});

test('a tmux start: the claude command quoted in send-keys -l', () => {
  const command = `tmux send-keys -t %3 -l "env HOME=/u ${ENV} claude -n t42-design --model haiku --effort low -- 'Read and follow /h/t.md'" && tmux send-keys -t %3 Enter`;
  assert.deepEqual(childStarts(command), [{ name: 't42-design', model: 'haiku', effort: 'low' }]);
});

test('a tmux start with the command as arguments: new-window or split-window, the variables in -e', () => {
  const env = ENV.split(' ').map((pair) => `-e ${pair}`).join(' ');
  const json = `--settings '{"crossSessionInbound":"accept"}'`;
  for (const create of ["new-window -d -c /h/product -n t42-api -P -F '#{pane_id}'", "split-window -h -d -t \"$TMUX_PANE\" -c /h/product -P -F '#{pane_id}'"]) {
    const command = `tmux ${create} ${env} -- claude ${json} -n t42-api --model sonnet --effort medium -- 'Read and follow /h/t.md'`;
    assert.deepEqual(childStarts(command), [{ name: 't42-api', model: 'sonnet', effort: 'medium' }], create);
  }
  assert.deepEqual(childStarts('tmux new-window -d -- claude --model opus'), [], 'no SESSION_HUB_ROLE=child: not a child start');
});

test('a herdr start: the flags after --, the name from -n or else the agent', () => {
  assert.deepEqual(childStarts('herdr agent start t42-docs --kind claude --pane p1 -- -n t42-docs --model sonnet --effort medium'), [
    { name: 't42-docs', model: 'sonnet', effort: 'medium' },
  ]);
  assert.deepEqual(childStarts('herdr agent start t9 --kind claude --pane p1 -- --model fable'), [{ name: 't9', model: 'fable', effort: undefined }]);
});

test('several children in one command give one line each', () => {
  const one = `env ${ENV} claude --bg -n a --model opus --effort high -- x`;
  const two = `env ${ENV} claude --bg -n b --model haiku --effort low -- y`;
  assert.deepEqual(childStarts(`${one}; ${two}`).map((start) => start.name), ['a', 'b']);
});

test('no line for a command that is not a child start, or states neither model nor effort', () => {
  for (const command of ['claude --model opus -p "hi"', 'git status', `env ${ENV} claude --bg -n a -- x`, 'herdr agent prompt t42 "go"',
    'tmux send-keys -t %3 Enter', 'echo "claude --model opus"', 'echo "unclosed', `SESSION_HUB_ROLE=master claude --model opus`]) {
    assert.deepEqual(childStarts(command), [], command);
  }
});

test('the line as text, and as segments in the shared look', () => {
  const start = { name: 't42-product', model: 'opus', effort: 'high' };
  assert.equal(startLineText(start), '⎿  🔀 opus   ▰▰▰▱ high   -> t42-product');
  assert.deepEqual(startLineSegments(start), [
    { text: '  ⎿  ', tone: 'dim' },
    { text: '🔀 ' },
    { text: 'opus  ', color: '#3b82f6', bold: true },
    { text: ' ' },
    { text: '▰▰▰', color: '#f97316' },
    { text: '▱', color: '#3a3f47' },
    { text: ' ' },
    { text: 'high  ', color: '#f97316' },
    { text: ' -> t42-product', tone: 'dim' },
  ]);
  assert.equal(startLineText({ name: 'c', model: 'gpt-x' }), '⎿  🔀 gpt-x  ▱▱▱▱ default -> c');
});
