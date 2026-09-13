import { describe, expect, it } from 'vitest';
import real from './__fixtures__/backup-2026-08-14.json';
import { burnRate } from './insights';
import { goalPlan, goalScenarios, projectGoal, requirementFor, type Capacity } from './goalPlan';
import { importBackup } from './importBackup';
import { safeSpend } from './safeSpend';
import type { Goal } from './types';

const FX = 13.6;
const NOW = new Date(2026, 7, 14, 12, 0, 0);

const egypt: Goal = {
  id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
  target: 1_100_000, alloc: 0, months: null, extEgp: 0, auto: false,
};

/** 9,714 pool, 1,470 spend → 8,244 saved. Mirrors the real ledger. */
const cap: Capacity = {
  poolBeforeGoal: 9714,
  projectedSpend: 1470,
  saving: 8244,
  daysInMonth: 31,
};

describe('goalPlan — the real Egypt goal', () => {
  const plan = goalPlan(egypt, cap, FX, NOW);

  it('reports how much is still missing', () => {
    expect(plan.remaining).toBe(1_100_000);
    expect(plan.currency).toBe('EGP');
  });

  it('converts saving capacity into the goal currency', () => {
    expect(plan.savingPerMonthAed).toBe(8244);
    expect(plan.savingPerMonth).toBeCloseTo(8244 * FX, 2);
  });

  it('gives a real arrival date instead of a shrug', () => {
    expect(plan.monthsAtPace).toBeCloseTo(1_100_000 / (8244 * FX), 3);
    expect(Math.ceil(plan.monthsAtPace ?? 0)).toBe(10);
    expect(plan.eta).not.toBeNull();
  });

  it('reports the zero-spend floor, which no plan can beat', () => {
    // 9,714 × 13.6 = 132,110 EGP a month at absolute maximum.
    expect(plan.floorMonths).toBeCloseTo(1_100_000 / (9714 * FX), 3);
    expect(plan.floorMonths).toBeGreaterThan(8);
  });

  it('has no blocker when money is genuinely being saved', () => {
    expect(plan.blocker).toBeNull();
  });
});

describe('goalPlan — why it says never', () => {
  it('names overspending rather than just refusing', () => {
    const broke: Capacity = { ...cap, projectedSpend: 9714, saving: 0 };
    const plan = goalPlan(egypt, broke, FX, NOW);
    expect(plan.blocker).toBe('no-capacity');
    expect(plan.monthsAtPace).toBeNull();
    // The floor still exists, so the app can say what WOULD be possible.
    expect(plan.floorMonths).toBeGreaterThan(0);
  });

  it('names a missing target', () => {
    expect(goalPlan({ ...egypt, target: null }, cap, FX, NOW).blocker).toBe('no-target');
  });

  it('reports an already-met goal as met, not never', () => {
    const plan = goalPlan({ ...egypt, extEgp: 1_200_000 }, cap, FX, NOW);
    expect(plan.blocker).toBe('met');
    expect(plan.monthsAtPace).toBe(0);
  });
});

describe('projectGoal — where the money actually gets me', () => {
  it('answers how far 8 months gets you', () => {
    const at8 = projectGoal(egypt, cap, FX, 8);
    expect(at8.amount).toBeCloseTo(8244 * FX * 8, 2);
    expect(at8.reached).toBe(false);
    expect(at8.shortfall).toBeGreaterThan(0);
    // Roughly 82% of the way there.
    expect(at8.progress).toBeGreaterThan(0.8);
    expect(at8.progress).toBeLessThan(0.85);
  });

  it('reports arrival once the horizon is long enough', () => {
    expect(projectGoal(egypt, cap, FX, 12).reached).toBe(true);
  });

  it('counts money already held', () => {
    const withHeld = projectGoal({ ...egypt, extEgp: 200_000 }, cap, FX, 0);
    expect(withHeld.amount).toBe(200_000);
  });

  it('never projects backwards when nothing is being saved', () => {
    const broke: Capacity = { ...cap, saving: -500 };
    expect(projectGoal(egypt, broke, FX, 6).amount).toBe(0);
  });
});

describe('requirementFor — what would it actually take', () => {
  it('proves an 8-month deadline impossible on this salary', () => {
    const req = requirementFor(egypt, 8, cap, FX);
    // 137,500 EGP a month = 10,110 AED, more than the entire 9,714 pool.
    expect(req.perMonth).toBe(1_100_000 / 8);
    expect(req.perMonthAed).toBeCloseTo(10_110.29, 1);
    expect(req.livingLeftAed).toBeLessThan(0);
    expect(req.feasible).toBe(false);
  });

  it('shows a 12-month deadline as possible but requiring a cut', () => {
    const req = requirementFor(egypt, 12, cap, FX);
    expect(req.feasible).toBe(true);
    expect(req.maxDailyAed).toBeGreaterThan(0);
    expect(req.perMonthAed).toBeLessThan(cap.poolBeforeGoal);
  });

  it('translates the deadline into a daily spending cap', () => {
    const req = requirementFor(egypt, 12, cap, FX);
    expect(req.maxDailyAed).toBeCloseTo(req.livingLeftAed / 31, 6);
    expect(req.currentDailyAed).toBeCloseTo(1470 / 31, 6);
    expect(req.dailyCutAed).toBeCloseTo(req.currentDailyAed - req.maxDailyAed, 6);
  });

  it('marks a deadline that needs no change as comfortable', () => {
    const req = requirementFor(egypt, 24, cap, FX);
    expect(req.comfortable).toBe(true);
    expect(req.gapAed).toBeLessThanOrEqual(0);
  });

  it('never divides by zero months', () => {
    expect(Number.isFinite(requirementFor(egypt, 0, cap, FX).perMonth)).toBe(true);
  });
});

describe('goalScenarios', () => {
  const scenarios = goalScenarios(egypt, cap, FX);

  it('offers plans ordered fastest first', () => {
    expect(scenarios.length).toBeGreaterThan(0);
    for (let i = 1; i < scenarios.length; i++) {
      expect(scenarios[i]!.months).toBeGreaterThanOrEqual(scenarios[i - 1]!.months);
    }
  });

  it('never offers a plan faster than the zero-spend floor', () => {
    const floor = goalPlan(egypt, cap, FX, NOW).floorMonths ?? 0;
    expect(scenarios[0]!.months).toBeGreaterThanOrEqual(Math.floor(floor));
  });

  it('collapses duplicates when every plan converges', () => {
    const frugal: Capacity = { ...cap, projectedSpend: 0, saving: cap.poolBeforeGoal };
    expect(goalScenarios(egypt, frugal, FX)).toHaveLength(1);
  });

  it('returns nothing for a goal already met', () => {
    expect(goalScenarios({ ...egypt, extEgp: 2_000_000 }, cap, FX)).toHaveLength(0);
  });
});

describe('safeSpend — card dues are deducted from the living pool', () => {
  const { ledger, settings } = importBackup(real);
  const c = safeSpend(ledger, settings.fxRate, NOW);

  it('subtracts last cycle statement, which is payable this month', () => {
    // 1,286 statement was spent LAST cycle, so it is not in cycleSpend and
    // would otherwise be invisible to the daily limit.
    expect(c.cc.stmtRem).toBe(1286);
    expect(c.cardDueParts.statement).toBe(1286);
  });

  it('also subtracts unbilled spending carried in from before the cycle', () => {
    // Of 790.79 unbilled, 681.81 was spent this cycle and is already an
    // expense. The remaining 108.98 predates the cycle: in no other total, and
    // until this was fixed, deducted nowhere at all.
    expect(c.cc.unbilled).toBeCloseTo(790.79, 2);
    expect(c.cardCycleUnbilled).toBeCloseTo(681.81, 2);
    expect(c.cardDueParts.carried).toBeCloseTo(108.98, 2);
    expect(c.cardDue).toBeCloseTo(1394.98, 2);
    expect(c.livingPool).toBeCloseTo(11000 - 1394.98, 2);
  });

  it('does NOT subtract this cycle unbilled spending, already an expense', () => {
    expect(c.cardCycleUnbilled).toBeGreaterThan(0);
    // Were it deducted here too, the pool would drop by it a second time.
    expect(c.livingPool).toBeCloseTo(11000 - c.cardDue, 10);
    expect(c.cardDue).toBeLessThan(c.cc.stmtRem + c.cc.unbilled + c.cc.instMo);
  });

  it('lowers the daily limit accordingly', () => {
    // The old figure was ~560/day; deducting the statement brings it down.
    expect(c.ssl).toBeLessThan(560);
    expect(c.ssl).toBeGreaterThan(400);
  });

  it('feeds a capacity that matches the real ledger', () => {
    const burn = burnRate(ledger, c.livingPool, NOW);
    const poolBeforeGoal = ledger.base - c.commitObl - c.planT - c.cardDue;
    expect(poolBeforeGoal).toBeCloseTo(9605.02, 2);
    expect(burn.projectedMonth).toBeGreaterThan(0);
  });
});

describe('safeSpend — baseline starts the count from today', () => {
  const { ledger } = importBackup(real);
  const monthStart = new Date(2026, 7, 1).getTime();
  const baselineTs = new Date(2026, 7, 14, 8, 0, 0).getTime();

  it('ignores spending before the baseline and uses the declared figure', () => {
    const withBase = {
      ...ledger,
      baseline: { ts: baselineTs, cycleSpentBefore: 300 },
    };
    const c = safeSpend(withBase, FX, NOW);
    // 681.81 was actually recorded this month, but the user declared 300.
    expect(c.cycleSpend).toBe(300);
  });

  it('counts anything recorded after the baseline on top', () => {
    const withBase = {
      ...ledger,
      baseline: { ts: baselineTs, cycleSpentBefore: 300 },
      tx: [
        { id: 'new', ts: baselineTs + 3600e3, type: 'expense' as const, acct: 'card' as const, amt: 50 },
        ...ledger.tx,
      ],
    };
    expect(safeSpend(withBase, FX, NOW).cycleSpend).toBe(350);
  });

  it('ignores a baseline from a previous cycle', () => {
    const old = { ...ledger, baseline: { ts: monthStart - 86400e3, cycleSpentBefore: 9999 } };
    expect(safeSpend(old, FX, NOW).cycleSpend).toBeCloseTo(681.81, 2);
  });
});

describe('goalScenarios never offers a plan you cannot live on', () => {
  const egypt: Goal = {
    id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
    target: 1_100_000, alloc: 0, months: null, extEgp: 0, auto: true,
  };
  const cap: Capacity = {
    poolBeforeGoal: 6018, projectedSpend: 1240, saving: 4778, daysInMonth: 31,
  };
  const band = { min: 20, comfort: 40 };

  it('drops every option below the declared floor', () => {
    // The reported bug: a "fastest" plan offering nine dirhams a day while a
    // living floor sat right beside it.
    for (const s of goalScenarios(egypt, cap, 13.6, band)) {
      expect(s.requirement.maxDailyAed).toBeGreaterThanOrEqual(band.min - 1e-6);
    }
  });

  it('bases the fastest plan on the floor, not on spending nothing', () => {
    const withBand = goalScenarios(egypt, cap, 13.6, band);
    const unbounded = goalScenarios(egypt, cap, 13.6, null);
    const fastestWith = withBand.find((s) => s.id === 'fastest');
    const fastestWithout = unbounded.find((s) => s.id === 'fastest');
    // Spending the floor rather than nothing means the goal takes longer —
    // which is the honest answer.
    if (fastestWith && fastestWithout) {
      expect(fastestWith.months).toBeGreaterThanOrEqual(fastestWithout.months);
    }
  });

  it('still offers something when the band leaves room', () => {
    expect(goalScenarios(egypt, cap, 13.6, band).length).toBeGreaterThan(0);
  });

  it('offers a slow plan rather than an unliveable one when money is tight', () => {
    // Pool 700 against a floor costing 620: only 80 a month is genuinely
    // free. The honest answer is a very long plan, not a fast impossible one.
    const tight: Capacity = { ...cap, poolBeforeGoal: 700 };
    const out = goalScenarios(egypt, tight, 13.6, band);
    for (const s of out) {
      expect(s.requirement.maxDailyAed).toBeGreaterThanOrEqual(band.min - 1e-6);
      expect(s.months).toBeGreaterThan(cap.daysInMonth);
    }
  });

  it('offers nothing at all when the floor alone exceeds the pool', () => {
    const broke: Capacity = { ...cap, poolBeforeGoal: 400 };
    expect(goalScenarios(egypt, broke, 13.6, band)).toEqual([]);
  });

  it('keeps working with no band declared', () => {
    expect(goalScenarios(egypt, cap, 13.6, null).length).toBeGreaterThan(0);
  });
});
