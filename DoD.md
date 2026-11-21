# Definition of Done

## Requirements

- [ ] Structural checks pass: `bash tests/validate.sh`
- [ ] Unit tests pass: `node --test` on every `*.test.mjs`
- [ ] Manifests are valid: `claude plugin validate ./session-hub --strict` and `claude plugin validate ./model-router --strict`
- [ ] Mod tests pass, for a plugin that has a mod: `claude plugin test ./<plugin>`
- [ ] A pull request that changes a plugin bumps `version` in its `plugin.json` (see `AGENTS.md`)
- [ ] A change to what one plugin assumes about the other is in `docs/design/shared-contract.md` first
- [ ] A design change is reflected in `docs/design/`; a spike that was run has its result recorded in `docs/design/spikes.md` with the Claude Code version
- [ ] Manual scenarios touched by the change were run and their outcome noted in the pull request
- [ ] Each plugin README still says correctly what it does and whether it works without the other plugin
- [ ] At the end of every work cycle, the repository `README.md` and the user manual (`docs/manual/manual.html`) are reviewed against the change: what they claim still matches the plugins, the screenshots in `docs/manual/images/` still show the current interface, and `docs/manual/user-manual.pdf` is rebuilt with `docs/manual/build.sh` when the manual changed. The pull request says what was reviewed and what changed
- [ ] At the end of every work cycle, the documentation site (`site/`) is reviewed against the change: its text, diagrams and screenshots still match the plugins and each other, in English and in Italian; `node site/check.mjs` passes (links, images, translations, reproducible build); pages whose English changed are translated again with `node site/translate.mjs`; screenshots that no longer show the current interface are retaken. The pull request says what was reviewed and what changed
- [ ] A new or changed skill has had its description and context use reviewed with the `skill-creator` skill; the pull request says what changed
- [ ] At a release: `docs/architecture.md` matches the released code, checked by an independent documentation review
- [ ] No AI attribution, session link or AI-service URL in commits, the pull request or documents
- [ ] The pull request is merged into `main` with the `validate` check green
