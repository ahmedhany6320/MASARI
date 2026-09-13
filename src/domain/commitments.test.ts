import { describe, expect, it } from 'vitest';
import { commitmentStatus, commitmentsDue, cycleKey, isPaidFor } from './commitments';
import type { Commitment } from './types';

// 14 Aug 2026. Local constructors throughout, matching the engine.
const NOW = new Date(2026, 7, 14, 12, 0, 0);

let seq = 0;
function commit(over: Partial<Commitment> = {}): Commitment {
  return {
    id: `k${seq++}`, ar: 'التزام', en: 'Commitment',
    amt: 1000, day: 5, paused: false, paidMonth: false, ...over,
  };
}

describe('cycleKey', () => {
  it('is the calendar month, zero padded', () => {
    expect(cycleKey(NOW)).toBe('2026-08');
    expect(cycleKey(new Date(2026, 0, 31))).toBe('2026-01');
  });
});

describe('isPaidFor — the flag has to expire', () => {
  it('honours a stamp for the current cycle', () => {
    expect(isPaidFor(commit({ paidFor: '2026-08' }), NOW)).toBe(true);
  });

  it('ignores a stamp from a previous cycle', () => {
    // The whole point: last month being settled says nothing about this month.
    expect(isPaidFor(commit({ paidFor: '2026-07' }), NOW)).toBe(false);
  });

  it('lets the stamp override a stale legacy flag', () => {
    const c = commit({ paidMonth: true, paidFor: '2026-07' });
    expect(isPaidFor(c, NOW)).toBe(false);
  });

  it('still honours a legacy flag with no stamp, for this cycle only', () => {
    expect(isPaidFor(commit({ paidMonth: true }), NOW)).toBe(true);
  });
});

describe('commitmentStatus — what it is and what it claims', () => {
  it('marks one falling due later this cycle as upcoming', () => {
    const s = commitmentStatus(commit({ day: 25 }), NOW);
    expect(s.state).toBe('upcoming');
    expect(s.daysAway).toBe(11);
    expect(s.due?.getDate()).toBe(25);
    expect(s.claims).toBe(true);
    expect(s.needsConfirm).toBe(false);
  });

  it('marks one due today', () => {
    const s = commitmentStatus(commit({ day: 14 }), NOW);
    expect(s.state).toBe('today');
    expect(s.daysAway).toBe(0);
    expect(s.claims).toBe(true);
  });

  it('marks a passed, unticked one overdue and asks about it', () => {
    const s = commitmentStatus(commit({ day: 5 }), NOW);
    expect(s.state).toBe('overdue');
    expect(s.daysAway).toBe(-9);
    // Still owed, so still deducted — but the app says it is unsure.
    expect(s.claims).toBe(true);
    expect(s.needsConfirm).toBe(true);
  });

  it('claims nothing once paid for this cycle', () => {
    const s = commitmentStatus(commit({ paidFor: '2026-08' }), NOW);
    expect(s.state).toBe('paid');
    expect(s.claims).toBe(false);
    expect(s.amount).toBe(0);
  });

  it('claims again after the cycle turns over', () => {
    const c = commit({ paidFor: '2026-08' });
    expect(commitmentStatus(c, NOW).claims).toBe(false);
    expect(commitmentStatus(c, new Date(2026, 8, 3)).claims).toBe(true);
  });

  it('claims nothing while paused', () => {
    expect(commitmentStatus(commit({ paused: true }), NOW).claims).toBe(false);
  });

  it('flags an incomplete one instead of deducting a guess', () => {
    expect(commitmentStatus(commit({ amt: null }), NOW).state).toBe('incomplete');
    expect(commitmentStatus(commit({ day: null }), NOW).state).toBe('incomplete');
    expect(commitmentStatus(commit({ amt: null }), NOW).claims).toBe(false);
  });

  it('pulls day 31 back into a short month rather than spilling over', () => {
    // September has 30 days; a due date of 31 Sep would land in October and be
    // reported as belonging to the wrong cycle entirely.
    const s = commitmentStatus(commit({ day: 31 }), new Date(2026, 8, 10, 12));
    const due = s.due;
    if (due == null) throw new Error('expected a due date');
    expect(due.getMonth()).toBe(8);
    expect(due.getDate()).toBe(30);
  });
});

describe('commitmentsDue — the cycle total', () => {
  const commits = [
    commit({ amt: 2000, day: 25 }),               // upcoming
    commit({ amt: 1500, day: 3 }),                // overdue
    commit({ amt: 900, day: 10, paidFor: '2026-08' }), // paid
    commit({ amt: 700, day: 8, paused: true }),   // paused
    commit({ amt: null, day: 12 }),               // incomplete
  ];
  const d = commitmentsDue(commits, NOW);

  it('deducts only what is genuinely still owed', () => {
    expect(d.total).toBe(3500);
    expect(d.upcoming).toBe(2000);
    expect(d.overdue).toBe(1500);
    expect(d.paid).toBe(900);
    expect(d.incomplete).toBe(1);
  });

  it('asks about exactly the ambiguous ones', () => {
    expect(d.needsConfirm).toBe(1);
  });

  it('puts the ones needing attention first', () => {
    expect(d.items.map((x) => x.state).slice(0, 2)).toEqual(['overdue', 'upcoming']);
  });

  it('claims nothing at all from an empty plan', () => {
    const e = commitmentsDue([], NOW);
    expect(e.total).toBe(0);
    expect(e.needsConfirm).toBe(0);
  });
});
