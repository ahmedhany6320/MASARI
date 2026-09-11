import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { safeSpend } from './safeSpend';
import type { Commitment, Goal, Ledger, Tx } from './types';

const FX = 13.6;
// 14 Aug 2026 noon → 18 days to payday.
const NOW = new Date(2026, 7, 14, 12, 0, 0);
const EARLIER = new Date(2026, 7, 3).getTime();

let seq = 0;
function spend(amt: number, ts: number, acct: 'bank' | 'card' | 'cash' = 'bank'): Tx {
  return { id: `x${seq++}`, ts, type: 'expense', acct, amt };
}
function commit(amt: number, day: number, over: Partial<Commitment> = {}): Commitment {
  return { id: `k${seq++}`, ar: '', en: '', amt, day, paused: false, paidMonth: false, ...over };
}
function led(over: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(), base: 11000, bankOpen: 6000, ...over };
}

describe('the balance basis — "this is all the money I have"', () => {
  it('sizes the limit from money held, not from the salary', () => {
    // Salary is 11,000 but only 6,000 is left: starting mid-cycle, the balance
    // is the fact and the salary is only there to date the next payday.
    const s = led({ sslBasis: 'balance' });
    const c = safeSpend(s, FX, NOW);
    expect(c.basis).toBe('balance');
    expect(c.livingPool).toBe(6000);
    expect(c.ssl).toBeCloseTo(6000 / 18, 10);
  });

  it('does not subtract spending history, which the balance already reflects', () => {
    // On the salary basis this 2,000 would come off the pool. Here it is
    // already missing from the 6,000, and subtracting it again would charge it
    // twice — the exact trap of mixing the two bases.
    const s = led({ sslBasis: 'balance', tx: [spend(2000, EARLIER, 'bank')] });
    const c = safeSpend(s, FX, NOW);
    expect(c.spendable).toBe(4000);
  });

  it('still subtracts this cycle card spending, which the balance cannot see', () => {
    // Card spending has not left the bank yet, so the balance is unchanged by
    // it — but the money is spent all the same.
    const s = led({ sslBasis: 'balance', tx: [spend(800, EARLIER, 'card')] });
    const c = safeSpend(s, FX, NOW);
    expect(c.cardCycleUnbilled).toBe(800);
    expect(c.spendable).toBe(6000 - 800);
  });

  it('still honours every claim on the money', () => {
    const s = led({
      sslBasis: 'balance',
      commits: [commit(1000, 25)],
      planTf: [{ id: 'p1', amt: 500, day: 20 }],
    });
    const c = safeSpend(s, FX, NOW);
    expect(c.livingPool).toBe(6000 - 1000 - 500);
  });

  it('counts cash alongside the bank', () => {
    const s = led({ sslBasis: 'balance', cashOpen: 1500 });
    expect(safeSpend(s, FX, NOW).livingPool).toBe(7500);
  });

  it('leaves the salary basis exactly as it was when unset', () => {
    const c = safeSpend(led(), FX, NOW);
    expect(c.basis).toBe('salary');
    expect(c.livingPool).toBe(11000);
  });
});

describe('commitments are scheduled, not just summed', () => {
  it('deducts one still to fall due this cycle', () => {
    const c = safeSpend(led({ commits: [commit(2000, 25)] }), FX, NOW);
    expect(c.commitObl).toBe(2000);
    expect(c.commitments.upcoming).toBe(2000);
  });

  it('still deducts an overdue one, but asks about it', () => {
    const c = safeSpend(led({ commits: [commit(2000, 3)] }), FX, NOW);
    expect(c.commitObl).toBe(2000);
    expect(c.commitments.overdue).toBe(2000);
    expect(c.commitments.needsConfirm).toBe(1);
  });

  it('stops deducting one paid for this cycle', () => {
    const c = safeSpend(led({ commits: [commit(2000, 3, { paidFor: '2026-08' })] }), FX, NOW);
    expect(c.commitObl).toBe(0);
  });

  it('deducts it again next cycle, which the old boolean never did', () => {
    // The bug this replaces: a bill ticked in August stayed ticked forever.
    const s = led({ commits: [commit(2000, 3, { paidFor: '2026-08' })] });
    expect(safeSpend(s, FX, new Date(2026, 8, 14, 12)).commitObl).toBe(2000);
  });

  it('deducts nothing for one with no amount set', () => {
    const c = safeSpend(led({ commits: [commit(0, 10)] }), FX, NOW);
    expect(c.commitObl).toBe(0);
    expect(c.commitments.incomplete).toBe(1);
  });
});

describe('the goal basis — fix the duration, the spend is the lever', () => {
  const egypt: Goal = {
    id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
    target: 1_100_000, alloc: 0, months: 8, extEgp: 0, auto: false,
  };

  function goalLed(over: Partial<Ledger> = {}): Ledger {
    return {
      ...emptyLedger(),
      base: 11000,
      sslBasis: 'goal',
      minDailySpend: 60,
      goals: [egypt],
      ...over,
    };
  }

  it('plans at the floor when the target is out of reach', () => {
    const c = safeSpend(goalLed(), FX, NOW);
    expect(c.basis).toBe('goal');
    expect(c.plan?.source).toBe('floor');
    expect(c.plan?.dailyAllowance).toBe(60);
  });

  it('starts the month on exactly the planned figure', () => {
    // Day one, nothing spent: the loop has no variance to react to, so it
    // must agree with the plan rather than inventing a different number.
    const c = safeSpend(goalLed(), FX, new Date(2026, 7, 1, 12));
    expect(c.allowance).toBeCloseTo(60, 6);
  });

  it('keeps the PLAN figure steady while the daily figure responds', () => {
    // The plan is the commitment and does not drift with the calendar; the
    // daily figure is what answers back to real spending.
    const early = safeSpend(goalLed(), FX, new Date(2026, 7, 3, 12));
    const late = safeSpend(goalLed(), FX, new Date(2026, 7, 28, 12));
    expect(early.plan?.dailyAllowance).toBe(late.plan?.dailyAllowance);
  });

  it('gives the goal everything the plan does not spend', () => {
    const c = safeSpend(goalLed(), FX, NOW);
    // 11,000 pool − 60 × 31 living = 9,140 to the goal each month.
    expect(c.goalReq).toBeCloseTo(11000 - 60 * 31, 6);
    expect(c.plan?.monthlyToGoal).toBeCloseTo(9140, 6);
  });

  it('says where the goal lands rather than refusing the deadline', () => {
    const c = safeSpend(goalLed(), FX, NOW);
    expect(c.plan?.reachesTarget).toBe(false);
    expect(c.plan?.projected).toBeGreaterThan(0);
    expect(c.plan?.gap).toBeGreaterThan(0);
    expect(c.plan?.target).toBe(1_100_000);
  });

  it('names the spend that would reach a target within reach', () => {
    const c = safeSpend(goalLed({ goals: [{ ...egypt, target: 27_200, months: 2 }] }), FX, NOW);
    expect(c.plan?.source).toBe('target');
    expect(c.plan?.reachesTarget).toBe(true);
    expect(c.plan?.dailyForTarget).toBeGreaterThan(60);
    expect(c.plan?.dailyAllowance).toBe(c.plan?.dailyForTarget);
  });

  it('moves the landing figure with what is really spent', () => {
    const onPlan = safeSpend(goalLed(), FX, NOW);
    const overspent = safeSpend(goalLed({ tx: [spend(4000, EARLIER, 'bank')] }), FX, NOW);
    expect(overspent.planProjected).toBeLessThan(onPlan.planProjected ?? 0);
  });

  it('tightens the days that remain after an overspend', () => {
    // The answer chosen for this: the month absorbs the overspend so the goal
    // does not, and the daily figure comes down to make that true.
    const onPlan = safeSpend(goalLed(), FX, NOW);
    const overspent = safeSpend(goalLed({ tx: [spend(900, EARLIER, 'bank')] }), FX, NOW);
    expect(overspent.allowance).toBeLessThan(onPlan.allowance);
  });

  it('never tightens past the survival floor', () => {
    const wrecked = safeSpend(
      goalLed({ minDailySpend: 20, comfortDailySpend: 60, tx: [spend(50_000, EARLIER, 'bank')] }),
      FX,
      NOW,
    );
    expect(wrecked.allowance).toBe(20);
    expect(wrecked.daily?.zone).toBe('floor');
    // And the shortfall is charged somewhere explicit rather than vanishing.
    expect(wrecked.daily?.goalAbsorbed).toBeGreaterThan(0);
  });

  it('falls back to the salary basis when no goal has a duration', () => {
    const c = safeSpend(goalLed({ goals: [{ ...egypt, months: null }] }), FX, NOW);
    expect(c.plan).toBeNull();
    expect(c.allowance).toBeGreaterThan(0);
  });
});

describe('a planned goal steers without being switched on', () => {
  const egypt: Goal = {
    id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
    target: 1_100_000, alloc: 0, months: 8, extEgp: 0, auto: false,
  };
  const planned = (over: Partial<Ledger> = {}): Ledger => ({
    ...emptyLedger(), base: 11000, minDailySpend: 60, goals: [egypt], ...over,
  });

  it('steers by default, with no basis chosen', () => {
    // Setting a target and a duration IS the request. Requiring a settings
    // toggle on top meant the answer was never seen.
    const c = safeSpend(planned(), FX, NOW);
    expect(c.basis).toBe('goal');
    expect(c.plan).not.toBeNull();
    expect(c.plan?.dailyAllowance).toBe(60);
  });

  it('yields to an explicit salary choice', () => {
    const c = safeSpend(planned({ sslBasis: 'salary' }), FX, NOW);
    expect(c.basis).toBe('salary');
    // The plan is still computed, so the projection can be shown either way.
    expect(c.plan).not.toBeNull();
  });

  it('yields to an explicit balance choice', () => {
    expect(safeSpend(planned({ sslBasis: 'balance', bankOpen: 4000 }), FX, NOW).basis).toBe('balance');
  });

  it('stays on the salary cycle when no goal has a duration', () => {
    const c = safeSpend(planned({ goals: [{ ...egypt, months: null }] }), FX, NOW);
    expect(c.basis).toBe('salary');
    expect(c.plan).toBeNull();
  });

  it('stays on the salary cycle when there are no goals at all', () => {
    expect(safeSpend(planned({ goals: [] }), FX, NOW).basis).toBe('salary');
  });
});

describe('the cash reserve is protected before the goal', () => {
  const egypt: Goal = {
    id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
    target: 1_100_000, alloc: 0, months: 8, extEgp: 0, auto: false,
  };
  const withBuffer = (over: Partial<Ledger> = {}): Ledger => ({
    ...emptyLedger(), base: 11000, minDailySpend: 60, goals: [egypt], ...over,
  });

  it('changes nothing when no reserve is set', () => {
    const c = safeSpend(withBuffer(), FX, NOW);
    expect(c.bufferReq).toBe(0);
    expect(c.bufferTarget).toBe(0);
    expect(c.goalReq).toBeCloseTo(11000 - 60 * 31, 6);
  });

  it('takes its share from the GOAL, never from the living floor', () => {
    // The ordering that matters: a goal taking everything above the floor
    // leaves nothing for the days that exceed it.
    const plain = safeSpend(withBuffer(), FX, NOW);
    const saved = safeSpend(withBuffer({ bufferTarget: 6000 }), FX, NOW);

    expect(saved.bufferReq).toBeGreaterThan(0);
    expect(saved.goalReq).toBeLessThan(plain.goalReq);
    // The daily limit is untouched: the reserve costs the goal time, not the
    // user their life.
    expect(saved.allowance).toBe(plain.allowance);
  });

  it('spreads the shortfall rather than demanding it at once', () => {
    const c = safeSpend(withBuffer({ bufferTarget: 6000 }), FX, NOW);
    expect(c.bufferReq).toBeCloseTo(6000 / 6, 6);
    expect(c.bufferShort).toBe(6000);
  });

  it('counts free liquid toward it and stops once full', () => {
    // A stock, not a permanent tax: the contribution ends by itself.
    const c = safeSpend(withBuffer({ bufferTarget: 6000, bankOpen: 9000 }), FX, NOW);
    expect(c.bufferHeld).toBeGreaterThanOrEqual(6000);
    expect(c.bufferFunded).toBe(true);
    expect(c.bufferReq).toBe(0);
  });

  it('yields to the living floor when the pool cannot cover both', () => {
    const c = safeSpend(
      withBuffer({ bufferTarget: 100_000, base: 2000, minDailySpend: 60 }),
      FX,
      NOW,
    );
    // 60 x 31 = 1,860 of a 2,000 pool, so at most 140 can go to the reserve.
    expect(c.bufferReq).toBeLessThanOrEqual(2000 - 60 * 31 + 1e-6);
    expect(c.livingPool).toBeGreaterThanOrEqual(0);
  });

  it('does not promise the goal money the reserve has taken', () => {
    // The projection has to be built from the pool the goal actually gets,
    // or the plan reports a landing point it is never funded to reach.
    const plain = safeSpend(withBuffer(), FX, NOW);
    const saved = safeSpend(withBuffer({ bufferTarget: 6000 }), FX, NOW);
    expect(saved.plan?.projected).toBeLessThan(plain.plan?.projected ?? 0);
    expect(saved.plan?.monthlyToGoal).toBeCloseTo(saved.goalReq, 6);
  });
});
