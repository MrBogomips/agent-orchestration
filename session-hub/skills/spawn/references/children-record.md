# Children record

One JSON file per hub, written only by the master through the helper script, never by hand. `session-hub:spawn`
and `session-hub:dispatch` both use it.

```bash
R="${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs"
node "$R" path --hub /abs/hub                                  # default path
node "$R" reconcile --hub /abs/hub --live <name,name,...>      # live names from the session list
node "$R" upsert --hub /abs/hub --entry '<json>'               # one entry, merged by name
node "$R" status --hub /abs/hub --name <child> --status <s> [--reason <why>]
node "$R" request --hub /abs/hub --name <child> --text <t> --outcome <o>
node "$R" master --hub /abs/hub --name <master> --ref <ref> --session-id <id>   # this session, at each start
node "$R" outbox --hub /abs/hub [--remove <file,file,...>]                     # messages children could not deliver
node "$R" read --hub /abs/hub
```

Examples, for the messages a child sends:

```bash
R="${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs"
node "$R" upsert --hub /abs/hub --entry '{"name":"<child>","lastMessage":{"type":"pr","at":"<ISO time>","text":"<url>"}}'
node "$R" status --hub /abs/hub --name <child> --status done
node "$R" request --hub /abs/hub --name <child> --text "<request>" --outcome "<what was decided>"
```

## How to call it

- Pass `--hub` (and `--file`) as a literal absolute path, never `.`, `$PWD` or a variable, and define `R=` in the
  same Bash call as the command. With mods on, the `session-hub` mod recognises the master from these calls: it
  reads the command for `registry.mjs` and a literal absolute `--hub` or `--file`, and only then turns on the
  children panel.
- The default path is `<config dir>/session-hub/children-<hub id>.json` (`CLAUDE_CONFIG_DIR`, else `~/.claude`;
  a relative `CLAUDE_CONFIG_DIR` is refused). When the hub's *Registry* key gives a path, add `--file <path>` to
  every call, next to `--hub`: a write with `--file` and no `--hub` is refused. The script refuses a path that lands
  inside the hub, also through a link or a folder that does not exist yet.
- Each command takes only its own options (above); an unknown or repeated option, or `--live` with `--live-none`,
  exits 1 and writes nothing.
- Use the exact child name, the one given with `-n <name>` at the start. `upsert` with an unknown name creates a
  new entry with status `running`, so a misspelt name makes a second child. `status` and `request` refuse a name
  that is not in the record.

## Rules

- `reconcile` refuses an empty `--live`. Pass `--live-none` only when the session list was read and shows no
  live session; if the list could not be read, skip the reconcile and say so.
- `upsert` merges fields by name but never changes `started` or `requests`; add a request with `request`. An
  `upsert` with status `running` or `waiting-user` onto a `done`, `abandoned` or `lost` entry is a new child under
  the old name: it gets a fresh entry, with nothing of the old one.
- Writes take a lock next to the file. The script waits up to 5 seconds for it, then fails without writing;
  a lock older than 30 seconds, or whose writer has ended, is stale and taken over. Retry once, then treat it as
  an error.
- `master` keeps the master's identity as given to the children: `name`, `ref`, `sessionId`, `updatedAt`. The
  `session-hub` mod compares it with the master's current name to tell that it was renamed while children run.
  Write it at every start of children, with the values put on their launch commands; leave out `--session-id`
  when `scripts/launch.mjs` printed `null`.
- An entry: `name`, `repo`, `task`, `scope` (`writeRoot`, `external`), `model`, `effort`, `status`, `reason` (set
  with `status --reason`, dropped by the next status without one), `started`, `lastMessage` (`type`, `at`, `text`),
  `requests`. Status is one of `running`, `waiting-user`, `done`,
  `abandoned`, `lost`. The record holds names, paths and URLs only, never project content.
- If the script reports an error (for example a corrupt file), stop recording, tell the user what it said and
  where the file is, and carry on: the record is never a reason not to start a child or to stop the work. Never
  delete or overwrite the file to get past the error.
- A project that also wants notes in its own tracker keeps that rule; the record does not replace it.

## Outbox

When a child's message to the master is not delivered (the master ended, restarted under another name, or cannot
be reached), the child's `session-hub` mod saves it in the outbox, a folder next to the record: the record
`children-<hub id>.json` has `children-<hub id>.outbox/`, one JSON file per message (`at`, `from.sessionId`, `to`,
`reason`, `text`). It is the only part a child writes, and only through its mod.

- `outbox` lists the messages, oldest first, as `{ dir, messages, removed }`; each message has its `file` name. A
  file that cannot be read is listed with an `error`.
- Handle each message as if it had just arrived (`session-hub:dispatch`, *Messages from children*), then remove
  it with `--remove <file>`: by name only, and only the files you handled, so that a message that arrived in the
  meantime stays. `--remove` with `--file` needs `--hub`, like every write.
- The outbox holds what the children wrote, which may be project content: remove each message once handled.
