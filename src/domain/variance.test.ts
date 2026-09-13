import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import type { Commitment, Ledger, Tx } from './types';
import { commitmentActual, varianceReport } from './variance';

// 12 September 2026.
const NOW = new Date(2026, 8, 12, 12, 0, 0);
const CYCLE = '2026-09';

let seq = 0;
function commit(amt: number, over: Partial<Commitment> = {}): Commitment {
  return {
    id: `k${seq++}`, ar: 'التزام', en: 'Commitment',
    amt, day: 1, paused: false, paidMonth: false, ...over,
  };
}
function remit(amt: number, day: number): Tx {
  return {
    id: `r${seq++}`, ts: new Date(2026, 8, day, 12).getTime(),
    type: 'remit', acct: 'bank', amt,
  };
}
function led(over: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(), ...over };
}

describe('commitmentActual — the plan is not the outcome', () => {
  it('is nothing while the commitment is unsettled', () => {
    expect(commitmentActual(commit(1800), NOW)).toBeNull();
  });

  it('is the planned figure when settled without editing it', () => {
    // Marking it paid and changing nothing means it cost what was budgeted.
    expect(commitmentActual(commit(1800, { paidFor: CYCLE }), NOW)).toBe(1800);
  });

  it('is the recorded figure when one was entered', () => {
    expect(commitmentActual(commit(1800, { paidFor: CYCLE, actual: 1750 }), NOW)).toBe(1750);
  });

  it('goes back to nothing when the cycle turns', () => {
    const c = commit(1800, { paidFor: CYCLE, actual: 1750 });
    expect(commitmentActual(c, new Date(2026, 9, 3))).toBeNull();
  });
});

describe('varianceReport — the difference belongs to the goal', () => {
  it('gives the goal what a cheap month left over', () => {
    // Rent budgeted at 1,800 and paid at 1,750.
    const r = varianceReport(led({ commits: [commit(1800, { paidFor: CYCLE, actual: 1750 })] }), NOW);
    expect(r.toGoal).toBe(50);
    expect(r.paid).toBe(1750);
    expect(r.outstanding).toBe(0);
  });

  it('takes from the goal when something cost more', () => {
    const r = varianceReport(led({ commits: [commit(300, { paidFor: CYCLE, actual: 340 })] }), NOW);
    expect(r.toGoal).toBe(-40);
  });

  it('nets the two against each other', () => {
    // Rent 50 under, internet 40 over: the goal gains 10.
    const r = varianceReport(
      led({
        commits: [
          commit(1800, { paidFor: CYCLE, actual: 1750 }),
          commit(300, { paidFor: CYCLE, actual: 340 }),
        ],
      }),
      NOW,
    );
    expect(r.toGoal).toBe(10);
  });

  it('claims nothing from an obligation still waiting', () => {
    const r = varianceReport(led({ commits: [commit(1800), commit(300, { paidFor: CYCLE })] }), NOW);
    expect(r.outstanding).toBe(1800);
    expect(r.pending).toBe(1);
    // The unpaid one contributes no variance: nothing has happened to it yet.
    expect(r.toGoal).toBe(0);
  });

  it('ignores a paused commitment entirely', () => {
    const r = varianceReport(led({ commits: [commit(1800, { paused: true })] }), NOW);
    expect(r.planned).toBe(0);
    expect(r.commitments).toHaveLength(0);
  });

  it('does not carry last month variance into this one', () => {
    const r = varianceReport(
      led({ commits: [commit(1800, { paidFor: '2026-08', actual: 1000 })] }),
      NOW,
    );
    expect(r.toGoal).toBe(0);
    expect(r.outstanding).toBe(1800);
  });
});

describe('varianceReport — transfers work the same way', () => {
  it('credits the goal when less was sent than planned', () => {
    // Planned 850, actually sent 400: the other 450 is the goal's.
    const r = varianceReport(
      led({
        planTf: [{ id: 'tf', amt: 850, day: 20, sentFor: CYCLE }],
        tx: [remit(400, 8)],
      }),
      NOW,
    );
    expect(r.transfers[0]?.actual).toBe(400);
    expect(r.toGoal).toBe(450);
  });

  it('charges the goal when more was sent', () => {
    const r = varianceReport(
      led({
        planTf: [{ id: 'tf', amt: 850, day: 20, sentFor: CYCLE }],
        tx: [remit(1000, 8)],
      }),
      NOW,
    );
    expect(r.toGoal).toBe(-150);
  });

  it('leaves an unsent plan as money still expected to go', () => {
    const r = varianceReport(led({ planTf: [{ id: 'tf', amt: 850, day: 20 }] }), NOW);
    expect(r.outstanding).toBe(850);
    expect(r.toGoal).toBe(0);
  });

  it('counts only remittances from this cycle', () => {
    const r = varianceReport(
      led({
        planTf: [{ id: 'tf', amt: 850, day: 20, sentFor: CYCLE }],
        // August's transfer must not be read as September's.
        tx: [{ id: 'old', ts: new Date(2026, 7, 20).getTime(), type: 'remit', acct: 'bank', amt: 5000 }],
      }),
      NOW,
    );
    expect(r.transfers[0]?.actual).toBe(0);
    expect(r.toGoal).toBe(850);
  });

  it('adds commitments and transfers into one figure', () => {
    const r = varianceReport(
      led({
        commits: [commit(1800, { paidFor: CYCLE, actual: 1750 })],
        planTf: [{ id: 'tf', amt: 850, day: 20, sentFor: CYCLE }],
        tx: [remit(400, 8)],
      }),
      NOW,
    );
    expect(r.toGoal).toBe(50 + 450);
    expect(r.paid).toBe(1750 + 400);
  });

  it('is quiet on an empty plan', () => {
    const r = varianceReport(led(), NOW);
    expect(r.toGoal).toBe(0);
    expect(r.planned).toBe(0);
    expect(r.pending).toBe(0);
  });
});

describe('the variance reaches the goal, and rent does not eat the day', () => {
  it('lifts the goal when obligations came in under budget', async () => {
    const { safeSpend } = await import('./safeSpend');
    const base = led({
      base: 11000,
      minDailySpend: 20,
      comfortDailySpend: 40,
      goals: [{
        id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
        target: 1_100_000, alloc: 0, months: 8, extEgp: 0, auto: true,
      }],
      commits: [commit(1800, { day: 1 })],
    });
    const onPlan = safeSpend({ ...base, commits: [commit(1800, { day: 1, paidFor: CYCLE })] }, 13.6, NOW);
    const cheap = safeSpend(
      { ...base, commits: [commit(1800, { day: 1, paidFor: CYCLE, actual: 1500 })] },
      13.6,
      NOW,
    );
    expect(cheap.variance.toGoal).toBe(300);
    expect(cheap.targetAdapted?.adapted).toBeGreaterThan(onPlan.targetAdapted?.adapted ?? 0);
  });

  it('does not charge a settled commitment to the daily allowance', async () => {
    const { safeSpend } = await import('./safeSpend');
    const base = led({ base: 11000, minDailySpend: 20, comfortDailySpend: 40 });

    const rentTx: Tx = {
      id: 'rent-paid', ts: new Date(2026, 8, 1, 12).getTime(),
      type: 'expense', acct: 'bank', amt: 1800, commitId: 'k-rent',
    };
    const groceries: Tx = {
      id: 'g', ts: new Date(2026, 8, 1, 12).getTime(),
      type: 'expense', acct: 'card', amt: 1800,
    };

    // Identical amounts: one tagged as a commitment settlement, one not.
    const withRent = safeSpend({ ...base, tx: [rentTx] }, 13.6, NOW);
    const withSpending = safeSpend({ ...base, tx: [groceries] }, 13.6, NOW);

    expect(withRent.cycleSpend).toBe(0);
    expect(withSpending.cycleSpend).toBe(1800);
    expect(withRent.allowance).toBeGreaterThan(withSpending.allowance);
  });
});
