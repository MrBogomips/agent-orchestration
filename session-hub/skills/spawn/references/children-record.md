# Children record

One JSON file per hub, written only by the master through the helper script, never by hand. `session-hub:spawn`
and `session-hub:dispatch` both use it.

```bash
R="${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs"
node "$R" path --hub /abs/hub                                  # default path
node "$R" reconcile --hub /abs/hub --live <name,name,...>      # live names from the session list
node "$R" upsert --hub /abs/hub --entry '<json>'               # one entry, merged by name
node "$R" status --hub /abs/hub --name <child> --status <s>
node "$R" request --hub /abs/hub --name <child> --text <t> --outcome <o>
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
- The default path is `<config dir>/session-hub/children-<hub id>.json` (`CLAUDE_CONFIG_DIR`, else `~/.claude`).
  When the hub's *Registry* key gives a path, add `--file <path>` to every call; the script refuses a path inside
  the hub.
- Use the exact child name, the one given with `-n <name>` at the start. `upsert` with an unknown name creates a
  new entry with status `running`, so a misspelt name makes a second child. `status` and `request` refuse a name
  that is not in the record.

## Rules

- `reconcile` refuses an empty `--live`. Pass `--live-none` only when the session list was read and shows no
  live session; if the list could not be read, skip the reconcile and say so.
- `upsert` merges fields by name but never changes `started` or `requests`; add a request with `request`.
- Writes take a lock next to the file. The script waits up to 5 seconds for it, then fails without writing;
  a lock older than 30 seconds is stale and removed. Retry once, then treat it as an error.
- An entry: `name`, `repo`, `task`, `scope` (`writeRoot`, `external`), `model`, `effort`, `status`, `started`,
  `lastMessage` (`type`, `at`, `text`), `requests`. Status is one of `running`, `waiting-user`, `done`,
  `abandoned`, `lost`. The record holds names, paths and URLs only, never project content.
- If the script reports an error (for example a corrupt file), stop recording, tell the user what it said and
  where the file is, and carry on: the record is never a reason not to start a child or to stop the work. Never
  delete or overwrite the file to get past the error.
- A project that also wants notes in its own tracker keeps that rule; the record does not replace it.
