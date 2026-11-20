# Scenario: setup

Fixture from [README.md](README.md).

## New hub

Ask: "Set up session-hub for this hub."

- [ ] The proposal lists `design/`, `product/` and `prototype/` with their base branches
- [ ] It proposes the *Backlog* section as a *Master only* candidate and asks; it does not decide it
- [ ] It leaves out keys that only restate defaults, apart from *Repositories*
- [ ] Nothing is written before an explicit yes; "don't write" leaves the file unchanged
- [ ] On yes, the section is appended to `AGENTS.md` (not written through the `CLAUDE.md` link), the rest of the
      file is unchanged, and nothing is committed

## Hub configured for spawn-session

Add an old section with `- Agent: claude` and `- Propagate: Confidentiality`, then run setup.

- [ ] The proposal drops `Agent` and says why
- [ ] It explains that *Propagate* now serves only children outside the hub and asks whether to keep it
- [ ] Values the user set are kept

## Refusals

- [ ] Asked to set `- Registry: <hub>/state/children.json`, setup refuses: state stays outside the hub
