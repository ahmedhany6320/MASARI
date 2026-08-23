import { describe, expect, it } from 'vitest';
import { fundGoals, heldFor } from './funding';
import type { Goal } from './types';

const FX = 13.6;

let seq = 0;
function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: `g${seq++}`, ar: 'هدف', en: 'Goal',
    target: null, alloc: 0, months: null, auto: false, ...over,
  };
}

describe('fundGoals — an auto goal draws from the balance', () => {
  it('fills an auto goal from the bank with nothing to type', () => {
    // The whole complaint: alloc sat at zero and could not be edited, so the
    // goal showed no progress however much was actually saved.
    const g = goal({ auto: true, target: 20000, currency: 'AED' });
    const plan = fundGoals([g], 8000, FX);
    expect(plan.goals[0]?.held).toBe(8000);
    expect(plan.goals[0]?.fromBalance).toBe(true);
    expect(plan.free).toBe(0);
  });

  it('stops at the target rather than swallowing the whole balance', () => {
    const g = goal({ auto: true, target: 5000, currency: 'AED' });
    const plan = fundGoals([g], 9000, FX);
    expect(plan.goals[0]?.held).toBe(5000);
    expect(plan.free).toBe(4000);
  });

  it('converts an EGP target before drawing against it', () => {
    // 27,200 EGP is 2,000 AED at 13.6.
    const g = goal({ auto: true, target: 27200, currency: 'EGP' });
    const plan = fundGoals([g], 9000, FX);
    expect(plan.goals[0]?.held).toBeCloseTo(2000, 6);
  });

  it('counts money already in Egypt toward the target', () => {
    // 27,200 EGP target with 13,600 EGP already there needs only 1,000 AED.
    const g = goal({ auto: true, target: 27200, currency: 'EGP', extEgp: 13600 });
    const plan = fundGoals([g], 9000, FX);
    expect(plan.goals[0]?.held).toBeCloseTo(1000, 6);
  });

  it('gives an untargeted auto goal whatever is left', () => {
    const plan = fundGoals([goal({ auto: true })], 3000, FX);
    expect(plan.goals[0]?.held).toBe(3000);
    expect(plan.free).toBe(0);
  });
});

describe('fundGoals — manual goals keep what was declared', () => {
  it('takes the declared figure at face value', () => {
    const plan = fundGoals([goal({ alloc: 2500 })], 9000, FX);
    expect(plan.goals[0]?.held).toBe(2500);
    expect(plan.goals[0]?.fromBalance).toBe(false);
    // The balance is untouched: a manual goal claims no part of it.
    expect(plan.free).toBe(9000);
  });

  it('does not clamp it to the visible balance', () => {
    // Manual exists precisely for money held somewhere the app cannot see;
    // reporting it as missing would defeat the point. `allocationCheck` is
    // what says whether the total is really backed.
    const plan = fundGoals([goal({ alloc: 50000 })], 3000, FX);
    expect(plan.goals[0]?.held).toBe(50000);
  });

  it('leaves the balance for the auto goals to draw on', () => {
    const plan = fundGoals([goal({ alloc: 4000 }), goal({ auto: true })], 6000, FX);
    expect(plan.goals.map((x) => x.held)).toEqual([4000, 6000]);
  });
});

describe('fundGoals — the balance is shared, not double counted', () => {
  const a = goal({ auto: true, target: 5000, currency: 'AED' });
  const b = goal({ auto: true, target: 5000, currency: 'AED' });
  const plan = fundGoals([a, b], 7000, FX);

  it('funds in declaration order and stops where the money stops', () => {
    expect(plan.goals.map((x) => x.held)).toEqual([5000, 2000]);
    expect(plan.funded).toBe(7000);
  });

  it('never hands the same dirham to two goals', () => {
    expect(plan.funded).toBeLessThanOrEqual(plan.liquid);
  });

  it('reports the shortfall on the goal that actually has one', () => {
    expect(plan.goals.map((x) => x.short)).toEqual([0, 3000]);
  });

  it('shares the balance between auto goals only', () => {
    const mixed = fundGoals(
      [goal({ auto: true, target: 4000, currency: 'AED' }), goal({ auto: true })],
      6000,
      FX,
    );
    expect(mixed.goals.map((x) => x.held)).toEqual([4000, 2000]);
  });
});

describe('fundGoals — edges', () => {
  it('funds nothing from an empty account', () => {
    const plan = fundGoals([goal({ auto: true, target: 5000 })], 0, FX);
    expect(plan.funded).toBe(0);
    expect(plan.goals[0]?.short).toBe(5000);
  });

  it('treats an overdrawn balance as nothing, not negative capital', () => {
    expect(fundGoals([goal({ auto: true })], -900, FX).liquid).toBe(0);
  });

  it('leaves the balance free when there are no goals', () => {
    expect(fundGoals([], 5000, FX).free).toBe(5000);
  });

  it('looks up one goal by id', () => {
    const g = goal({ auto: true, target: 1000, currency: 'AED' });
    expect(heldFor(fundGoals([g], 5000, FX), g.id)).toBe(1000);
    expect(heldFor(fundGoals([g], 5000, FX), 'nope')).toBe(0);
  });
});
