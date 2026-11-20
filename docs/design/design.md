# Design: coordinated parallel sessions and model routing

Status: approved direction, 2026-11-20. Items marked **settled** were decided by the user. Items marked
**proposal** are the designer's call and may be changed during the build. Items marked **unverified** rest on a
fact nobody has tested yet; `spikes.md` lists the tests.

## Intent

A user works from a *hub*: a folder that holds several git repositories. One session in the hub, the *master*,
coordinates. Work inside a repository is done by a *child* session started in that repository, so that it loads
the repository's own rules, skills and agents.

Today this is done with one Markdown skill, `spawn-session`. It starts the children and tells them how to report
back. It does not:

- give a child a scope it must stay in;
- make the master the only channel between sessions;
- say what a child does with a request outside its scope;
- choose a model or an effort level for a child;
- keep any record of the children that are running.

Separately, inside any session, subagents inherit the session's model. A session on the most capable model runs
its file searches on that model too.

The work covers both problems with two plugins:

- **`session-hub`** coordinates the master and its children.
- **`model-router`** picks the model and the effort level for sessions and for subagents. It is useful in any
  project, with or without a hub.

## Goals

1. When work starts, the master decides which repositories it touches and whether to start children, read the
   material itself, or delegate a read to a subagent.
2. Each child gets a handoff that holds: the task, the references outside its repository that it may read, the
   context it needs, and the communication rules.
3. A child has a written scope and does not act outside it. A request outside the scope goes to the master, which
   decides and dispatches it to the right child, starting one if needed.
4. Children talk to the master only, never to each other.
5. Each child starts with a model and an effort level that fit its task.
6. Subagents get a model and an effort level that fit their task, also when the agent that starts them does not
   think about it.
7. The master keeps a record of its children that survives compaction and a restart.

## Non-goals

- Support for agents other than Claude Code. The audience is a team that uses Claude Code (**settled**). The old
  `spawn-session` also drove Codex children through panes; that path is dropped unless it costs nothing to keep.
- Replacing a repository's own orchestration. A child may itself coordinate subagents under its repository's
  rules; `session-hub` does not reach below the child.
- Changing the model of a running session. The choice is made at start (see *Adversarial findings*, 2).
- Cost accounting. The decision log records choices so the grid can be tuned; it is not a billing tool.

## Anti-goals

These would make the result a failure even if it works:

- A master that starts a child for everything. Each child costs start-up context and the user's attention.
- Guards that fail silently open and leave the user believing the scope is enforced.
- A child that treats a message from the master as the user's approval for a merge, a push or a deletion.
- Two places that define the model grid and drift apart.

## Approaches considered

### Packaging

| Approach | Outcome |
|---|---|
| New plugin for routing only; `spawn-session` grows in place in the `skills` plugin | Rejected. No home for the mod that recognizes where a message came from, because `skills` holds portable skills only. |
| One new plugin holding everything | Rejected. Someone who wants only subagent routing would install the whole coordination layer. |
| **Two new plugins in one new repository** | **Settled.** Clear boundaries, full technical guards. Cost: `spawn-session` moves, which is a breaking change for a hub that pins it. |

### Who picks the model of a child session

| Approach | Outcome |
|---|---|
| A dedicated agent on the smallest model judges the handoff | Not recommended. It sees less than the master, its confidence is not calibrated, and there are only a few such decisions a day. |
| **The master applies a written grid** | **Proposal.** The master already holds the context and writes the handoff. It states its choice and reason in the start report, and the user can correct it. When in doubt it goes one level up. |
| Grid, plus a second opinion from a small-model judge at the extremes | Kept as an option if several coordinators in a team choose inconsistently. |

The user has not closed this choice. Build the grid first; add the judge only if use shows the need.

### Who picks the model of a subagent

| Approach | Outcome |
|---|---|
| Skill only: the grid tells the agent which model and effort to pass on each start | Works today, since the tool that starts subagents takes both. Depends on the agent applying it every time. |
| Mod only: a judge decides every start | Rejected. It overrides choices the agent made with more context than the judge has. |
| **Skill and mod together** | **Proposal.** The skill holds the grid and the agent passes explicit values. The mod acts only when no model was given, forces the top tier on risky work, and logs every decision. |

## Decisions

| Topic | Decision | Status |
|---|---|---|
| Audience | A team, Claude Code only | settled |
| Out-of-scope request | The child always sends it to the master, also when the user asks for it directly in the child's session. To change the scope, the user goes to the master. | settled |
| Packaging | Two new plugins, `session-hub` and `model-router` | settled |
| Repository | New, `MrBogomips/agent-orchestration`, one top-level folder per plugin | settled |
| Old skill | `spawn-session` is retired from the `skills` plugin when the new plugins enter the marketplace | settled |
| Names | One mod per plugin, named like the plugin. Everything visible outside the plugin (commands, hooks, messages, state files, environment variables) carries the plugin's name. | settled |
| Skill names | `session-hub:spawn`, `session-hub:dispatch`, `session-hub:setup`; `model-router:choose-model`, `model-router:setup` | settled |
| Commands | `/session-hub`, `/model-router` | settled |
| Order | Both plugins first, then the configuration of real hubs | settled |
| Child model choice | Grid applied by the master | proposal |
| Release order inside each plugin | Skills and the classic hook first, the mod second | proposal |
| Children record | A file kept by the master | proposal |
| Quality loop | `model-router` measures the outcome of each routing choice and adapts with memory and aging (`model-router-quality-loop.md`) | settled |

## Adversarial findings

These are the weak points found in the request. Each one shaped the design.

1. **A small-model judge for child sessions is the wrong tool.** See *Approaches considered*. A child in a
   repository may also be a coordinator whose subagents have fixed models, so the child's own model matters less
   than it seems.
2. **Model and effort are chosen at start only.** Changing the model mid-session discards the prompt cache. On
   failure the rule is: raise the effort for the next attempt if the session is young, otherwise start a new
   child one tier up with a handoff that says what went wrong.
3. **Scope is prose today, and two rules contradict it.**
   - The old child prompt says the user's direct instructions take precedence over the master's. The settled
     decision reverses this for scope.
   - A child started in a subfolder of the hub loads the hub's own instruction file from the parent
     folder (verified, `spikes.md` S5), including rules written for the master. The old skill assumes the opposite.
   - Real enforcement needs a hook that blocks writes outside the child's repository.
4. **The master as the only channel has a cost.** Every relay adds to the master's context, on the most expensive
   model. If the master compacts or closes, it forgets its children unless there is a record. Messages between
   sessions with different permission modes wait for the user's approval and expire after about five minutes.
5. **Parallelism is limited by the user's attention.** A message from the master authorizes nothing, so every
   approval gate in a child waits for the user in that child's pane. The master needs written criteria for *not*
   starting a child.
6. **A launcher that types into a child's pane looks like the user.** Keystrokes sent by a terminal multiplexer
   arrive with the same origin as the person's own typing. Only messages delivered by the engine carry a
   trustworthy origin. The first prompt of a child is therefore not evidence of anything; guards key on later
   deliveries.
7. **A mod cannot list other sessions.** It sees subagents and teammates of its own session. The children panel
   must read the record the master keeps, or call the session-listing tool (**unverified**).
8. **Mods fail open and are not sandboxed.** A hook that throws or times out is skipped unless it has an explicit
   fallback. A guard must be written to fail closed, and an organization can block personal mods.
