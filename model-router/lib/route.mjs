// The routing table of docs/design/model-router.md: which starts the router may change, and how.
// Plain ES module with no Node or engine imports, so both the mod and node scripts load it.
import { familyOf, tierRank, effortOf, raiseEffort } from './tiers.mjs';

/** Built-in agent types verified to inherit the parent's model in Claude Code 2.1.329 (spike S3). */
export const INHERITING_BUILTINS = Object.freeze(['general-purpose', 'Explore']);

/**
 * Whether an agent type leaves the model to the caller: `inherit` (routable), `fixed` (its definition names a
 * model) or `unknown` (no readable definition, or a file that declares another agent's name). `definitionText` is
 * the file found under the type's name, when there is one.
 */
export function definitionCase(subagentType, definitionText) {
  if (INHERITING_BUILTINS.includes(subagentType)) return 'inherit';
  if (typeof definitionText !== 'string') return 'unknown';
  const lines = definitionText.split('\n');
  if (lines[0]?.trim() !== '---') return 'inherit';
  let model = null;
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break;
    // Claude Code names an agent type after its frontmatter `name`, not its file name: a file found under the
    // type's name that declares another name is some other agent, and the type's own definition is unknown.
    const name = line.match(/^name\s*:\s*["']?([^"'#]*?)["']?\s*(#.*)?$/);
    if (name && name[1] && name[1] !== subagentType) return 'unknown';
    const m = line.match(/^model\s*:\s*["']?([^"'#\s]*)["']?/);
    if (m && model === null) model = m[1];
  }
  return model === null || model === '' || model === 'inherit' ? 'inherit' : 'fixed';
}

/**
 * Which row of the routing table a start falls in: `explicit`, `fork`, `off`, `forced`, `fixed`, or `judge`
 * when no model was given and the router may choose.
 */
export function routeCase({ subagentType, model, enabled, routeSubagents, forcedModel, definition }) {
  if (!routeSubagents || !enabled) return { route: 'off', reason: 'router off' };
  if (subagentType === 'fork') return { route: 'fork', reason: 'a fork inherits its parent' };
  if (model) return { route: 'explicit', reason: 'the call carries a model' };
  if (forcedModel) return { route: 'forced', reason: 'a session-wide subagent model is set' };
  if (definition !== 'inherit') {
    return { route: 'fixed', reason: definition === 'fixed' ? 'the definition fixes a model' : 'definition not readable' };
  }
  return { route: 'judge', reason: 'no model given' };
}

/** Whether the start is risky: the tag's marker, or the judge's `risky` above the threshold. */
export function isRisky(judge, tagRisky, riskThreshold) {
  if (tagRisky) return true;
  return typeof judge?.risky === 'number' && judge.risky > riskThreshold;
}

/**
 * The effort to put on the start call, or undefined to leave it. An explicit effort is kept; risky work gets at
 * least `high`; otherwise the judge's level when its confidence passes the bar (`low` is a downgrade).
 */
export function decideEffort({ judge, explicitEffort, risky, options }) {
  if (explicitEffort) return explicitEffort;
  const level = effortOf(judge?.effort);
  const confident = (bar) => typeof judge?.effortConfidence === 'number' && judge.effortConfidence >= bar;
  if (risky) return raiseEffort(level, 'high');
  if (!level) return undefined;
  const bar = level === 'low' ? options.minDowngradeConfidence : options.minUpgradeConfidence;
  return confident(bar) ? level : undefined;
}

/** The only class the frontier tier is for: the grid gives that tier to open-ended design alone. */
export const FRONTIER_CLASS = 'design-open';

/**
 * Whether a `frontier` answer stands: the task's class is the frontier one, the judge's confidence passes the
 * frontier bar and a frontier model is set. Otherwise the answer counts as `deep`, and never lowers a start.
 */
function frontierStands({ judge, cls, options, models }) {
  const isConfident = typeof judge.confidence === 'number' && judge.confidence >= options.minFrontierConfidence;
  return cls === FRONTIER_CLASS && isConfident && Boolean(models.frontier);
}

/**
 * The model decision at the start, against the model the subagent would run on otherwise (`current`). `cls` is
 * the task's class, from the tag or else from the judge.
 * Returns `{ action, model?, reason }`, `action` one of `downgrade`, `upgrade`, `keep`, `forced-risk`.
 */
export function decideModel({ judge, cls, current, risky, options, models }) {
  if (risky) {
    const deep = models.deep;
    if (tierRank(current) >= tierRank(deep) && tierRank(current) >= 0) {
      return { action: 'keep', reason: 'risky work: already at or above the deep tier' };
    }
    return { action: 'forced-risk', model: deep, reason: 'risky work: deep tier' };
  }
  if (!judge) return { action: 'keep', reason: 'no judge answer' };
  const isHeld = judge.tier === 'frontier' && !frontierStands({ judge, cls, options, models });
  const target = models[isHeld ? 'deep' : judge.tier];
  const from = tierRank(current);
  const to = tierRank(target);
  const conf = typeof judge.confidence === 'number' ? judge.confidence : null;
  const reason = `judge: ${judge.tier} at ${conf ?? 'no confidence'}${isHeld ? ', held to deep' : ''}`;
  const isUpgrade = from < 0 || to > from;
  if (familyOf(current) === familyOf(target) && from >= 0) return { action: 'keep', reason };
  // The judge asked for more than the deep tier: holding its answer must not take a start below what it has.
  if (isHeld && from > to) return { action: 'keep', reason };
  if (isUpgrade) {
    return conf !== null && conf >= options.minUpgradeConfidence ? { action: 'upgrade', model: target, reason } : { action: 'keep', reason };
  }
  return conf !== null && conf >= options.minDowngradeConfidence ? { action: 'downgrade', model: target, reason } : { action: 'keep', reason };
}
