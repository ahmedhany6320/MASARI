import { describe, expect, it } from 'vitest';
import { projectAtPace, spendPlan, steeringGoal, type PlanInputs } from './spendPlan';
import type { Goal } from './types';

const FX = 13.6;

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
    target: 1_100_000, alloc: 0, months: 8, extEgp: 0, auto: true, ...over,
  };
}
function inputs(over: Partial<PlanInputs> = {}): PlanInputs {
  return { poolBeforeGoal: 9605, daysInMonth: 31, heldAed: 0, floorDaily: 60, fx: FX, ...over };
}

describe('spendPlan — the duration is fixed, the spend is the lever', () => {
  it('names the daily spend that lands exactly on target', () => {
    // A reachable goal: 27,200 EGP (2,000 AED) over 2 months needs 1,000/month,
    // leaving 8,605 to live on across 31 days.
    const g = goal({ target: 27_200, months: 2 });
    const p = spendPlan(g, inputs());
    expect(p).not.toBeNull();
    expect(p?.source).toBe('target');
    expect(p?.dailyAllowance).toBeCloseTo((9605 - 1000) / 31, 6);
    expect(p?.reachesTarget).toBe(true);
    expect(p?.gap).toBe(0);
    expect(p?.impossible).toBe(false);
  });

  it('holds the floor and lets the GOAL give way when the target is out of reach', () => {
    // 1,100,000 EGP in 8 months needs 10,110/month against a 9,605 pool. The
    // old behaviour drove the limit toward zero; this keeps the floor.
    const p = spendPlan(goal(), inputs());
    expect(p?.source).toBe('floor');
    expect(p?.dailyAllowance).toBe(60);
    expect(p?.impossible).toBe(true);
    expect(p?.dailyForTarget).toBeNull();
  });

  it('says where the goal actually lands instead of refusing to answer', () => {
    const p = spendPlan(goal(), inputs());
    // 9,605 − (60 × 31) = 7,745/month to the goal, over 8 months, in EGP.
    expect(p?.monthlyToGoal).toBeCloseTo(7745, 6);
    expect(p?.projected).toBeCloseTo(7745 * 8 * FX, 4);
    expect(p?.gap).toBeGreaterThan(0);
    expect(p?.progress).toBeGreaterThan(0.7);
    expect(p?.progress).toBeLessThan(0.8);
  });

  it('keeps the aspiration exactly as set', () => {
    expect(spendPlan(goal(), inputs())?.target).toBe(1_100_000);
  });

  it('credits what the goal already holds, which can make it reachable', () => {
    // The same 8-month deadline: impossible from nothing, but 23,255 already
    // in the account is a third of the way there, and the remaining 57,627
    // over 8 months leaves 77/day to live on — comfortably above the floor.
    const withHeld = spendPlan(goal(), inputs({ heldAed: 23_255 }));
    const without = spendPlan(goal(), inputs({ heldAed: 0 }));

    expect(without?.impossible).toBe(true);
    expect(withHeld?.impossible).toBe(false);
    expect(withHeld?.source).toBe('target');
    expect(withHeld?.dailyForTarget).toBeCloseTo((9605 - 57_627.94 / 8) / 31, 1);
    expect(withHeld?.reachesTarget).toBe(true);
    expect(withHeld?.projected).toBeGreaterThan(without?.projected ?? 0);
  });

  it('reaches the target once the horizon is long enough', () => {
    const p = spendPlan(goal({ months: 24 }), inputs());
    expect(p?.reachesTarget).toBe(true);
    expect(p?.source).toBe('target');
    expect(p?.dailyForTarget).toBeGreaterThan(60);
  });

  it('spends everything, and saves nothing, when the floor is unaffordable', () => {
    const p = spendPlan(goal(), inputs({ poolBeforeGoal: 900, floorDaily: 60 }));
    expect(p?.source).toBe('pool');
    expect(p?.dailyAllowance).toBeCloseTo(900 / 31, 6);
    expect(p?.monthlyToGoal).toBe(0);
  });

  it('gives the whole pool to the goal when no floor is declared', () => {
    const p = spendPlan(goal(), inputs({ floorDaily: 0 }));
    expect(p?.dailyAllowance).toBe(0);
    expect(p?.monthlyToGoal).toBe(9605);
  });

  it('prices a one-dirham daily cut in the goal currency', () => {
    const p = spendPlan(goal(), inputs());
    // 1/day × 31 days × 8 months × 13.6 — a real, visible payoff.
    expect(p?.perDirhamPerDay).toBeCloseTo(31 * 8 * FX, 6);
  });

  it('handles an AED goal without applying a rate', () => {
    const p = spendPlan(goal({ currency: 'AED', target: 80_000, months: 8 }), inputs());
    expect(p?.projected).toBeCloseTo(7745 * 8, 6);
    expect(p?.perDirhamPerDay).toBeCloseTo(31 * 8, 6);
  });

  it('declines to plan without a target or a duration', () => {
    expect(spendPlan(goal({ target: null }), inputs())).toBeNull();
    expect(spendPlan(goal({ months: null }), inputs())).toBeNull();
    expect(spendPlan(goal({ months: 0 }), inputs())).toBeNull();
  });

  it('survives an empty pool without producing nonsense', () => {
    const p = spendPlan(goal(), inputs({ poolBeforeGoal: 0 }));
    expect(p?.dailyAllowance).toBe(0);
    expect(p?.monthlyToGoal).toBe(0);
    expect(Number.isFinite(p?.projected ?? NaN)).toBe(true);
  });
});

describe('steeringGoal', () => {
  it('picks the first goal with both a target and a duration', () => {
    const noPlan = goal({ id: 'a', months: null });
    const planned = goal({ id: 'b', months: 6 });
    expect(steeringGoal([noPlan, planned])?.id).toBe('b');
  });

  it('is null when nothing is planned', () => {
    expect(steeringGoal([goal({ months: null })])).toBeNull();
    expect(steeringGoal([])).toBeNull();
  });
});

describe('projectAtPace — the landing figure moves with real spending', () => {
  const g = goal();
  const p = spendPlan(g, inputs());

  it('raises the landing figure when spending runs under plan', () => {
    if (p == null) throw new Error('expected a plan');
    const under = projectAtPace(p, g, 0, 40 * 31, 9605, FX);
    expect(under).toBeGreaterThan(p.projected);
  });

  it('lowers it when spending runs over', () => {
    if (p == null) throw new Error('expected a plan');
    const over = projectAtPace(p, g, 0, 120 * 31, 9605, FX);
    expect(over).toBeLessThan(p.projected);
  });

  it('matches the plan exactly when spending is on plan', () => {
    if (p == null) throw new Error('expected a plan');
    expect(projectAtPace(p, g, 0, 60 * 31, 9605, FX)).toBeCloseTo(p.projected, 6);
  });

  it('never projects below what is already held', () => {
    if (p == null) throw new Error('expected a plan');
    expect(projectAtPace(p, g, 500, 99_999, 9605, FX)).toBeCloseTo(500 * FX, 6);
  });
});
