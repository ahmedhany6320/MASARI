import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { consistencyOf, evaluateFinancialState } from './engine';
import { goalPlan, requirementFor } from './goalPlan';
import { safeSpend } from './safeSpend';
import type { Ledger } from './types';

let n = 0;
const id = () => `c-${++n}`;
const NOW = new Date(2026, 8, 13, 12, 0, 0);
const FX = 13.6;

/**
 * A ledger with an auto goal already backed by a real balance, and almost
 * nothing recorded this month. That combination is what exposed both bugs:
 * the goal's savings were invisible to the projection, and the month's living
 * was being guessed from two logged purchases.
 */
function led(patch: Partial<Ledger> = {}): Ledger {
  return {
    ...emptyLedger(id),
    bankOpen: 14_000,
    cashOpen: 300,
    base: 11_000,
    cardCfg: { limit: 20_000, closeDay: 1, dueDay: 25 },
    cardSetup: {
      stmt0: 1_200,
      unbilled0: 108.98,
      instBal: 2_653,
      instMo: 221.08,
      setupAt: new Date(2026, 5, 1).getTime(),
    },
    minDailySpend: 20,
    comfortDailySpend: 40,
    bufferTarget: 1_500,
    commits: [
      { id: 'r', ar: 'إيجار', en: 'Rent', amt: 1_800, day: 1, paused: false, paidMonth: false },
      { id: 'n', ar: 'نت', en: 'Internet', amt: 300, day: 18, paused: false, paidMonth: false },
    ],
    planTf: [{ id: 't', amt: 850, day: 20, sentFor: null }],
    goals: [
      { id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP', target: 400_000, alloc: 0, months: 18, extEgp: 0, auto: true },
    ],
    tx: [
      { id: 'a', ts: new Date(2026, 8, 11, 13, 0).getTime(), type: 'expense', acct: 'card', amt: 52.5 },
      { id: 'b', ts: new Date(2026, 8, 12, 19, 0).getTime(), type: 'expense', acct: 'card', amt: 31 },
    ],
    ...patch,
  };
}

describe('the projection sees what the goal already holds', () => {
  const c = safeSpend(led(), FX, NOW);

  it('resolves an auto goal from the balance before assessing it', () => {
    // The bug: `project()` was handed the raw ledger, where an auto goal's
    // `alloc` is zero because its progress comes from the balance rather than
    // being typed in. So it assessed a goal holding 12,800 as holding nothing.
    expect(c.steering?.alloc).toBeGreaterThan(0);
    expect(c.projection?.goal?.alloc).toBe(c.steering?.alloc);
  });

  it('asks for what is still needed, not for the whole target', () => {
    // 400,000 EGP is 29,412 AED. Ignoring the 12,800 already held demanded
    // 1,634 a month; counting it asks 923.
    expect(c.projection!.assessment.requiredMonthlyAed).toBeCloseTo(c.goalAsked, 2);
    expect(c.projection!.assessment.requiredMonthlyAed).toBeLessThan(1_000);
  });

  it('and the goal screen asks the same', () => {
    const req = requirementFor(c.steering!, 18, c.capacity, FX);
    expect(req.perMonthAed).toBeCloseTo(c.projection!.assessment.requiredMonthlyAed, 2);
  });
});

describe('capacity is the plan, not an extrapolation of what was logged', () => {
  const c = safeSpend(led(), FX, NOW);

  it("takes the month's living from the projection", () => {
    // The bug: capacity estimated living from the burn rate — a straight-line
    // extrapolation of two logged purchases, reading as 193 a month against a
    // planned 1,200.
    expect(c.capacity.projectedSpend).toBeCloseTo(c.projection!.monthlyDiscretionary, 2);
    expect(c.capacity.projectedSpend).toBeGreaterThan(1_000);
  });

  it('is measured after the reserve, as the goal reservation is', () => {
    expect(c.capacity.poolBeforeGoal - c.capacity.projectedSpend).toBeCloseTo(c.capacity.saving, 2);
  });

  it('splits exactly into the goal and the surplus', () => {
    expect(c.capacity.saving).toBeCloseTo(c.goalReq + c.surplus, 2);
  });

  it('does not move when a purchase is recorded', () => {
    // Capacity is a plan. Logging lunch must not restate what the month can
    // put aside — which is precisely what a burn-rate estimate did.
    const quiet = safeSpend(led({ tx: [] }), FX, NOW);
    expect(c.capacity.projectedSpend).toBeCloseTo(quiet.capacity.projectedSpend, 2);
    expect(c.capacity.saving).toBeCloseTo(quiet.capacity.saving, 2);
  });

  it('agrees with what the goal screen reports as saving per month', () => {
    const plan = goalPlan(c.steering!, c.capacity, FX, NOW);
    expect(plan.savingPerMonthAed).toBeCloseTo(c.capacity.saving, 2);
  });
});

describe('the engine reports all of it as consistent', () => {
  it('finds no breach', () => {
    expect(evaluateFinancialState(led(), NOW, { fx: FX }).consistency).toEqual([]);
  });

  it('catches capacity that no longer splits into the goal and the surplus', () => {
    const good = safeSpend(led(), FX, NOW);
    const rules = consistencyOf({ ...good, surplus: good.surplus + 300 }, NOW, FX).map((b) => b.rule);
    expect(rules).toContain('capacity-splits');
  });

  it('catches a projection assessing a goal as holding nothing', () => {
    const good = safeSpend(led(), FX, NOW);
    const broken = {
      ...good,
      projection: {
        ...good.projection!,
        assessment: { ...good.projection!.assessment, requiredMonthlyAed: 1_634 },
      },
    };
    expect(consistencyOf(broken, NOW, FX).map((b) => b.rule)).toContain('required-monthly');
  });
});
