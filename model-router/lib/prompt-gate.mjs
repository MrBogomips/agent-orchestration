// Which typed prompts the mod stores. The outcome logic reads only the next two prompts inside the rework window
// after a subagent's report, so only those are kept: none before a report, none past the window, two at most after
// each report. See docs/design/model-router-quality-loop.md, "Signals".
// Plain ES module with no Node or engine imports, so both the mod and node scripts load it.

export const PROMPTS_AFTER_REPORT = 2;

/** A gate for one session: `reported(ms)` at each subagent report, `shouldRecord(ms)` for each typed prompt. */
export function promptGate(windowMin) {
  const windowMs = windowMin * 60000;
  let lastReport = null;
  let since = 0;
  return {
    reported(ms) {
      lastReport = ms;
      since = 0;
    },
    shouldRecord(ms) {
      if (lastReport === null || ms - lastReport > windowMs || since >= PROMPTS_AFTER_REPORT) return false;
      since += 1;
      return true;
    },
  };
}
