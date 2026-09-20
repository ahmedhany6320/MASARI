import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import {
  assess, dailyBudget, netPosition, project, simulate,
  SMOOTHING_DAYS, type LifestyleRange, type ProjectionInput,
} from './projection';
import type { Goal, Ledger, Tx } from './types';

const FX = 13.6;
const NOW = new Date(2026, 8, 12, 12, 0, 0); // 12 September
const RANGE: LifestyleRange = { min: 20, comfort: 40 };

const egypt: Goal = {
  id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
  target: 1_100_000, alloc: 0, months: 8, extEgp: 0, auto: true,
};

let seq = 0;
function led(over: Partial<Ledger> = {}): Ledger {
  return {
    ...emptyLedger(), base: 11000, bankOpen: 26186,
    cardSetup: { stmt0: 1356, unbilled0: 250, instBal: 0, instMo: 0, setupAt: null },
    commits: [
      { id: 'r', ar: 'إيجار', en: 'Rent', amt: 1800, day: 1, paused: false, paidMonth: false },
      { id: 'n', ar: 'نت', en: 'Internet', amt: 300, day: 18, paused: false, paidMonth: false },
    ],
    planTf: [{ id: 'tf', amt: 850, day: 20 }],
    goals: [egypt],
    ...over,
  };
}
function inp(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return { ledger: led(), fx: FX, now: NOW, range: RANGE, ...over };
}
function cardSpend(amt: number): Tx {
  return { id: `c${seq++}`, ts: NOW.getTime() - 864e5, type: 'expense', acct: 'card', amt };
}
function settle(amt: number): Tx {
  return { id: `p${seq++}`, ts: NOW.getTime() - 864e5, type: 'ccpay', acct: 'bank', amt };
}

describe('netPosition — one movement, one effect', () => {
  it('is the bank less everything owed on the card', () => {
    // 26,186 held against 1,356 statement and 250 unbilled.
    expect(netPosition(led(), NOW)).toBe(26186 - 1356 - 250);
  });

  it('falls once when something is charged to the card', () => {
    const before = netPosition(led(), NOW);
    const after = netPosition(led({ tx: [cardSpend(500)] }), NOW);
    expect(after).toBe(before - 500);
  });

  it('does NOT move when the card is settled', () => {
    // The bug this design removes: settling a card makes nobody poorer, so
    // counting the purchase and the settlement as two expenses is wrong.
    const before = netPosition(led(), NOW);
    const after = netPosition(led({ tx: [settle(1356)] }), NOW);
    expect(after).toBe(before);
  });

  it('charges a purchase once even when it is later settled', () => {
    const before = netPosition(led(), NOW);
    const after = netPosition(led({ tx: [cardSpend(500), settle(500)] }), NOW);
    expect(after).toBe(before - 500);
  });
});

describe('simulate — commitments are never charged twice', () => {
  it('adds no salary to the month already part spent', () => {
    const m = simulate(inp(), 40, 3);
    expect(m[0]?.income).toBe(0);
    expect(m[1]?.income).toBe(11000);
  });

  it('charges this month only what is still owed', () => {
    // Rent fell on the 1st and is already settled; only the internet remains.
    const settled = led({
      commits: [
        { id: 'r', ar: 'إيجار', en: 'Rent', amt: 1800, day: 1, paused: false, paidMonth: false, paidFor: '2026-09' },
        { id: 'n', ar: 'نت', en: 'Internet', amt: 300, day: 18, paused: false, paidMonth: false },
      ],
    });
    const m = simulate(inp({ ledger: settled }), 40, 3);
    expect(m[0]?.commitments).toBe(300);
    // Next month carries the full plan again.
    expect(m[1]?.commitments).toBe(2100);
  });

  it('does not re-charge a transfer already sent this cycle', () => {
    const sent = led({ planTf: [{ id: 'tf', amt: 850, day: 20, sentFor: '2026-09' }] });
    const m = simulate(inp({ ledger: sent }), 40, 3);
    expect(m[0]?.transfers).toBe(0);
    expect(m[1]?.transfers).toBe(850);
  });

  it('carries each month into the next', () => {
    const m = simulate(inp(), 40, 6);
    for (let i = 1; i < m.length; i++) {
      expect(m[i]?.openingNet).toBe(m[i - 1]?.closingNet);
    }
  });

  it('grows faster the less is spent', () => {
    const lean = simulate(inp(), 0, 8);
    const loose = simulate(inp(), 40, 8);
    expect(lean[7]?.accumulatedAed).toBeGreaterThan(loose[7]?.accumulatedAed ?? 0);
  });
});

describe('assess — is it reachable, and while living?', () => {
  it('calls an out-of-reach goal impossible and says what IS reachable', () => {
    // 1.1M EGP in 8 months on this ledger: not reachable spending nothing.
    const a = assess(inp(), egypt, 8);
    expect(a.feasibility).toBe('impossible');
    expect(a.maxReachable).toBeGreaterThan(0);
    expect(a.maxReachable).toBeLessThan(1_100_000);
    expect(a.shortfall).toBeGreaterThan(0);
  });

  it('reports the ceiling above the realistic figure, which is above austerity reversed', () => {
    const a = assess(inp(), egypt, 8);
    expect(a.maxReachable).toBeGreaterThan(a.austereReachable);
    expect(a.austereReachable).toBeGreaterThan(a.realisticReachable);
  });

  it('calls a comfortable goal feasible', () => {
    const easy: Goal = { ...egypt, target: 40_000, months: 8 };
    const a = assess(inp({ ledger: led({ goals: [easy] }) }), easy, 8);
    expect(a.feasibility).toBe('feasible');
    expect(a.requiredDaily).toBeGreaterThanOrEqual(RANGE.comfort);
  });

  it('labels a goal that only fits below the range unsustainable', () => {
    // Reachable, but only by living under the floor for the whole term.
    // Under the 726,240 ceiling but above the 600,576 a comfortable life
    // reaches: possible only by living below the range for the whole term.
    const tight: Goal = { ...egypt, target: 700_000, months: 8 };
    const a = assess(inp({ ledger: led({ goals: [tight] }) }), tight, 8);
    expect(a.feasibility).toBe('unsustainable');
    // And the realistic projection is still reported, not hidden.
    expect(a.realisticReachable).toBeGreaterThan(0);
  });

  it('says nothing about a goal with no target or no date', () => {
    expect(assess(inp(), { ...egypt, target: null }, 8).feasibility).toBe('unset');
    expect(assess(inp(), egypt, 0).feasibility).toBe('unset');
  });

  it('recognises a goal already met', () => {
    const done: Goal = { ...egypt, target: 1000, alloc: 1500, currency: 'AED' };
    expect(assess(inp({ ledger: led({ goals: [done] }) }), done, 8).feasibility).toBe('met');
  });
});

describe('dailyBudget — underspend frees capacity', () => {
  const base = {
    monthlyDiscretionary: 1200, daysInMonth: 30,
    daysElapsed: 11, daysLeft: 20, range: RANGE,
  };

  it('raises the days ahead when spending ran under plan', () => {
    // Ten days finished at 40 planned is 400; only 200 was spent.
    const under = dailyBudget({ ...base, spent: 200 });
    expect(under.variance).toBeCloseTo(200, 6);
    expect(under.freed).toBeCloseTo(200, 6);
    expect(under.today).toBeGreaterThan(under.planned);
    expect(under.onTrack).toBe(true);
  });

  it('redistributes the saving gradually, not all into tomorrow', () => {
    const under = dailyBudget({ ...base, spent: 200, smoothingDays: SMOOTHING_DAYS });
    // Strict would hand back the full 50/day at once; today takes 7/20 of the
    // way there, leaving the rest to the days behind it.
    expect(under.today).toBeGreaterThan(under.planned);
    expect(under.today).toBeLessThan(under.strict);
    expect(under.today).toBeCloseTo(40 + (under.strict - 40) * (7 / 20), 6);
  });

  it('matches the plan exactly when spending is on plan', () => {
    const onPlan = dailyBudget({ ...base, spent: 400 });
    expect(onPlan.variance).toBeCloseTo(0, 6);
    expect(onPlan.today).toBeCloseTo(onPlan.planned, 6);
  });
});

describe('dailyBudget — overspend is smoothed, never a collapse', () => {
  const base = {
    monthlyDiscretionary: 1200, daysInMonth: 30,
    daysElapsed: 11, daysLeft: 20, range: RANGE,
  };

  it('does not hand the whole correction to tomorrow', () => {
    // 700 spent against 400 planned. The exact figure would gut the days that
    // remain; today sits between the plan and it, never below it.
    const over = dailyBudget({ ...base, spent: 700 });
    expect(over.strict).toBeLessThan(over.planned);
    expect(over.today).toBeGreaterThan(over.strict);
    expect(over.today).toBeLessThan(over.planned);
  });

  it('converges on the exact figure as the month closes', () => {
    // Early on there is room to be gentle; by the last week there is not, and
    // pretending otherwise near payday is how a month ends overspent.
    const early = dailyBudget({ ...base, spent: 700, daysLeft: 20 });
    const late = dailyBudget({ ...base, spent: 700, daysLeft: 5 });
    expect(Math.abs(late.today - late.strict)).toBeLessThan(
      Math.abs(early.today - early.strict),
    );
  });

  it('stays inside the range for an ordinary overspend', () => {
    const over = dailyBudget({ ...base, spent: 500 });
    expect(over.today).toBeGreaterThanOrEqual(RANGE.min);
    expect(over.today).toBeLessThanOrEqual(RANGE.comfort);
  });

  it('never prints a figure below the floor', () => {
    const wrecked = dailyBudget({ ...base, spent: 5000 });
    expect(wrecked.today).toBe(RANGE.min);
  });

  it('names what the goal absorbs when the floor holds', () => {
    const wrecked = dailyBudget({ ...base, spent: 5000 });
    expect(wrecked.absorbed).toBeGreaterThan(0);
  });

  it('always lands between the plan and the exact figure', () => {
    for (const spent of [0, 200, 400, 700, 1100]) {
      const d = dailyBudget({ ...base, spent });
      const lo = Math.min(d.planned, d.strict);
      const hi = Math.max(d.planned, d.strict);
      // Before the floor is applied it is a genuine interpolation; the floor
      // can only ever raise it.
      expect(d.today).toBeGreaterThanOrEqual(Math.min(lo, RANGE.min) - 1e-9);
      expect(d.today).toBeLessThanOrEqual(Math.max(hi, RANGE.min) + 1e-9);
    }
  });

  it('survives a month with nothing budgeted', () => {
    const none = dailyBudget({ ...base, monthlyDiscretionary: 0, spent: 0 });
    expect(Number.isFinite(none.today)).toBe(true);
    expect(none.today).toBe(RANGE.min);
  });
});

describe('project — one source every screen can read', () => {
  const p = project(inp());

  it('states the net position and its parts', () => {
    expect(p.netNow).toBe(p.bank + p.cash - p.cardOutstanding);
    expect(p.cardOutstanding).toBe(1356 + 250);
  });

  it('honours the range rather than punishing an impossible goal', () => {
    // Nothing is gained by austerity when the target cannot be reached, so the
    // plan stays liveable and the shortfall is reported instead.
    expect(p.assessment.feasibility).toBe('impossible');
    expect(p.monthlyDiscretionary / 30).toBeCloseTo(RANGE.comfort, 6);
  });

  it('projects as many months as the goal asks for', () => {
    expect(p.months).toHaveLength(8);
  });

  it('exposes the monthly capacity behind the plan', () => {
    expect(p.monthlyCapacity).toBe(11000 - 2100 - 850);
  });
});

describe('every screen reads one projection', () => {
  it('safeSpend exposes it, and the daily figure comes from it', async () => {
    const { safeSpend } = await import('./safeSpend');
    const s = { ...led(), minDailySpend: 20, comfortDailySpend: 40 };
    const c = safeSpend(s, FX, NOW);

    expect(c.projection).not.toBeNull();
    const expected = dailyBudget({
      monthlyDiscretionary: c.projection!.monthlyDiscretionary,
      spent: c.cycleSpend,
      daysElapsed: NOW.getDate(),
      daysLeft: c.daysLeft,
      daysInMonth: 30,
      range: c.projection!.range,
    });
    expect(c.allowance).toBeCloseTo(expected.today, 6);
  });

  it('reports the same net position the projection computed', async () => {
    const { safeSpend } = await import('./safeSpend');
    const s = { ...led(), minDailySpend: 20, comfortDailySpend: 40 };
    const c = safeSpend(s, FX, NOW);
    expect(c.projection!.netNow).toBe(netPosition(s, NOW));
    expect(c.projection!.netNow).toBe(c.bank + (c.cash ?? 0) - c.projection!.cardOutstanding);
  });

  it('falls back to the old path only when no range is declared', async () => {
    const { safeSpend } = await import('./safeSpend');
    const bare = { ...led(), minDailySpend: null, comfortDailySpend: null };
    expect(safeSpend(bare, FX, NOW).projection).toBeNull();
  });

  it('moves the daily figure with real spending, both ways', async () => {
    const { safeSpend } = await import('./safeSpend');
    const s = { ...led(), minDailySpend: 20, comfortDailySpend: 40 };
    const spendOn = (amt: number): Tx[] => [
      { id: 'x', ts: new Date(2026, 8, 3, 12).getTime(), type: 'expense', acct: 'card', amt },
    ];
    const under = safeSpend({ ...s, tx: spendOn(100) }, FX, NOW).allowance;
    const onPlan = safeSpend({ ...s, tx: spendOn(440) }, FX, NOW).allowance;
    const over = safeSpend({ ...s, tx: spendOn(900) }, FX, NOW).allowance;

    expect(under).toBeGreaterThan(onPlan);
    expect(over).toBeLessThan(onPlan);
    // And never below the floor, however bad the month went.
    expect(safeSpend({ ...s, tx: spendOn(9000) }, FX, NOW).allowance).toBe(RANGE.min);
  });
});
