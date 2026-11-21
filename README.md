# agent-orchestration

Two Claude Code plugins for working across several repositories and several models.

| Plugin | What it does |
|---|---|
| [`session-hub`](session-hub/) | A master session in a hub of repositories starts one child session per repository, with a scope, a master-only channel and a record of the children. |
| [`model-router`](model-router/) | Chooses model and effort for sessions and subagents with one written grid, routes subagent starts that carry no model, and measures locally how well each choice worked; adapting is planned. |

Each plugin works without the other.

## Install

Both plugins are listed in the `mrbogomips` marketplace:

```text
/plugin marketplace add MrBogomips/claude-plugins
/plugin install session-hub@mrbogomips
/plugin install model-router@mrbogomips
```

## Documentation

- `docs/manual/user-manual.pdf`: the user manual for both plugins, with examples and screenshots (source
  `docs/manual/manual.html`, rebuilt with `docs/manual/build.sh`).
- `docs/architecture.md`: how both plugins work, as built, and what is planned.
- `docs/design/`: the design of both plugins and the tests run before building them.
- `docs/research/`: the research behind the design.

## License

MIT, see [LICENSE](LICENSE).
