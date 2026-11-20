# model-router scenarios

Manual checklists for the `model-router` plugin. Each run needs a live session with the plugin enabled
(`claude --plugin-dir <checkout>/model-router`, or installed from the marketplace) and mods turned on. Note the
Claude Code version in the pull request that ran them. The mod writes under the active config folder
(`CLAUDE_CONFIG_DIR`, else `~/.claude`), in `model-router/`: look there, never in the repository.

| File | What it covers |
|---|---|
| [scenario-mod.md](scenario-mod.md) | Routing a subagent started without a model, the event log, compaction, the report page, `/model-router`, failing open. |
