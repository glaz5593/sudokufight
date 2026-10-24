import { QA_BUG_STATUSES, QA_RESULTS, type QaBugStatus, type QaResult } from '@sudoku-fight/protocol';

import { isActiveBug, isBugResult, mayMarkClosedRun, nextBugStatus, runTakes } from './rules';

/** The bug states a mark leads to (docs/handoff/2026-10-23/qa-module/plan.md), the table of rules.ts. */
const TABLE: Record<QaResult, Record<'none' | QaBugStatus, QaBugStatus | null>> = {
  fail: { none: 'open', open: 'open', handled: 'reopened', verified: 'open', reopened: 'reopened' },
  partial: { none: 'open', open: 'open', handled: 'reopened', verified: 'open', reopened: 'reopened' },
  pass: { none: null, open: null, handled: 'verified', verified: 'verified', reopened: 'verified' },
  untested: { none: null, open: null, handled: 'handled', verified: 'verified', reopened: 'reopened' },
};

describe('nextBugStatus: what a mark does to a bug', () => {
  const cases = QA_RESULTS.flatMap((result) =>
    [null, ...QA_BUG_STATUSES].map((current) => [result, current] as const),
  );

  it.each(cases)('%s on %p', (result, current) => {
    expect(nextBugStatus(current, result)).toBe(TABLE[result][current ?? 'none']);
  });

  it('fail or partial opens a bug; after a fix ("handled") it reopens it', () => {
    expect(nextBugStatus(null, 'fail')).toBe('open');
    expect(nextBugStatus('handled', 'partial')).toBe('reopened');
  });

  it('pass after a fix verifies it; pass on a bug never fixed drops it', () => {
    expect(nextBugStatus('handled', 'pass')).toBe('verified');
    expect(nextBugStatus('reopened', 'pass')).toBe('verified');
    expect(nextBugStatus('open', 'pass')).toBeNull();
  });
});

describe('the other rules', () => {
  it('a run for claude or moshe takes their own tasks and both’s; all takes every task', () => {
    expect(runTakes('claude', 'claude')).toBe(true);
    expect(runTakes('claude', 'both')).toBe(true);
    expect(runTakes('claude', 'moshe')).toBe(false);
    expect(runTakes('moshe', 'moshe')).toBe(true);
    expect(runTakes('moshe', 'both')).toBe(true);
    expect(runTakes('moshe', 'claude')).toBe(false);
    for (const who of ['claude', 'moshe', 'both'] as const) expect(runTakes('all', who)).toBe(true);
  });

  it('fail and partial are the bugs; open and reopened the active ones', () => {
    expect(QA_RESULTS.filter(isBugResult)).toEqual(['partial', 'fail']);
    expect(QA_BUG_STATUSES.filter(isActiveBug)).toEqual(['open', 'reopened']);
    expect(isActiveBug(null)).toBe(false);
  });

  it('a closed run takes marks only on bugs not verified yet', () => {
    expect([null, ...QA_BUG_STATUSES].filter(mayMarkClosedRun)).toEqual(['open', 'handled', 'reopened']);
  });
});
