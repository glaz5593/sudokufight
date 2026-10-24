import type { QaBugStatus, QaResult, QaRunWho, QaWho } from '@sudoku-fight/protocol';

/**
 * The QA module's rules (docs/handoff/2026-10-23/qa-module/plan.md), pure: which tasks a run takes, and what a
 * mark does to a task's bug.
 *
 * A bug is a task marked fail or partial. Claude marks it handled (POST …/fix, with what was done and in which
 * version), and then it is tested again: pass verifies the fix, fail or partial reopens it. A mark changes the
 * bug state like this:
 *
 *   mark ↓  state →   none    open    handled    verified    reopened
 *   fail, partial     open    open    reopened   open        reopened
 *   pass              none    none    verified   verified    verified
 *   untested          none    none    handled    verified    reopened
 *
 * (pass on an open bug: it was never fixed, so it was no bug after all; untested on one: the mark was taken
 * back.) The fix's note and version stay through every mark. A closed run takes no new marks, but its bugs may
 * be tested again (mayMarkClosedRun).
 */

/** Who the agent's key acts as, in created_by, tested_by, handled_by and closed_by. */
export const QA_AGENT_ACTOR = 'claude';

/** A run for `runWho` takes a task for `taskWho`: 'all' every task; claude and moshe their own and both's. */
export function runTakes(runWho: QaRunWho, taskWho: QaWho): boolean {
  return runWho === 'all' || taskWho === 'both' || taskWho === runWho;
}

/** The marks that are a bug: fail and partial (both need "מה קרה בפועל"). */
export function isBugResult(result: QaResult): result is 'fail' | 'partial' {
  return result === 'fail' || result === 'partial';
}

/** A bug still waiting for a fix: open, or reopened after one. */
export function isActiveBug(status: QaBugStatus | null): boolean {
  return status === 'open' || status === 'reopened';
}

/** The bug state after a mark (the table above). */
export function nextBugStatus(current: QaBugStatus | null, result: QaResult): QaBugStatus | null {
  switch (result) {
    case 'fail':
    case 'partial':
      if (current === null || current === 'verified') return 'open';
      return current === 'handled' ? 'reopened' : current;
    case 'pass':
      if (current === 'handled' || current === 'reopened') return 'verified';
      return current === 'open' ? null : current;
    case 'untested':
      return current === 'open' ? null : current;
  }
}

/** A closed run takes a mark only on a task that is a bug not verified yet: open, handled or reopened. */
export function mayMarkClosedRun(status: QaBugStatus | null): boolean {
  return status === 'open' || status === 'handled' || status === 'reopened';
}
