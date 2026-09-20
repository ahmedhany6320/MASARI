import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { evaluateFinancialState } from './engine';
import { fundGoals, heldFor } from './funding';
import { project } from './projection';
import { safeSpend } from './safeSpend';
import { canSteer, steeringGoal } from './spendPlan';
import type { Goal, Ledger } from './types';

let n = 0;
const id = () => `g-${++n}`;
const NOW = new Date(2026, 8, 13, 12, 0, 0);
const FX = 13.6;

function goal(patch: Partial<Goal> & { id: string }): Goal {
  return {
    ar: patch.id,
    en: patch.id,
    currency: 'AED',
    target: 50_000,
    alloc: 0,
    months: 12,
    extEgp: 0,
    auto: true,
    ...patch,
  };
}

function led(goals: Goal[], patch: Partial<Ledger> = {}): Ledger {
  return {
    ...emptyLedger(id),
    bankOpen: 20_000,
    base: 11_000,
    minDailySpend: 20,
    comfortDailySpend: 40,
    goals,
    ...patch,
  };
}

describe('choosing the goal that steers', () => {
  const house = goal({ id: 'house' });
  const car = goal({ id: 'car', target: 30_000, months: 6 });
  const someday = goal({ id: 'someday', target: 100_000, months: null });

  it('takes the first dated goal when nothing has been chosen', () => {
    expect(steeringGoal([house, car])?.id).toBe('house');
  });

  it('takes the chosen goal over list order', () => {
    expect(steeringGoal([house, car], 'car')?.id).toBe('car');
  });

  it('skips a goal that cannot steer', () => {
    expect(steeringGoal([someday, car])?.id).toBe('car');
    expect(canSteer(someday)).toBe(false);
  });

  it('falls back rather than leaving no plan when the choice stops qualifying', () => {
    // The user picked the car, then cleared its date. Better the house steers
    // than nothing does.
    const undated = { ...car, months: null };
    expect(steeringGoal([house, undated], 'car')?.id).toBe('house');
  });

  it('falls back when the chosen goal has been deleted', () => {
    expect(steeringGoal([house, car], 'gone')?.id).toBe('house');
  });

  it('reports nothing when no goal can steer', () => {
    expect(steeringGoal([someday])).toBeNull();
    expect(steeringGoal([], 'house')).toBeNull();
  });
});

describe('every engine agrees on which goal it is', () => {
  const house = goal({ id: 'house' });
  const car = goal({ id: 'car', target: 30_000, months: 6 });

  it('the projection and the plan pick the same goal by default', () => {
    const l = led([house, car]);
    const s = safeSpend(l, FX, NOW);
    const p = project({ ledger: l, fx: FX, now: NOW, range: { min: 20, comfort: 40 } });
    expect(s.steering?.id).toBe(p.goal?.id);
    expect(s.steering?.id).toBe('house');
  });

  it('and the same goal when one is chosen', () => {
    // The bug: `project` wrote the selection rule out again, so two functions
    // chose independently while the goal screen showed a third.
    const l = led([house, car], { steerGoalId: 'car' });
    const s = safeSpend(l, FX, NOW);
    const p = project({ ledger: l, fx: FX, now: NOW, range: { min: 20, comfort: 40 } });
    expect(s.steering?.id).toBe('car');
    expect(p.goal?.id).toBe('car');
    expect(evaluateFinancialState(l, NOW, { fx: FX }).goal?.id).toBe('car');
  });

  it('the engine reports no inconsistency either way', () => {
    expect(evaluateFinancialState(led([house, car]), NOW, { fx: FX }).consistency).toEqual([]);
    expect(
      evaluateFinancialState(led([house, car], { steerGoalId: 'car' }), NOW, { fx: FX }).consistency,
    ).toEqual([]);
  });
});

describe('the chosen goal is funded first', () => {
  const house = goal({ id: 'house', target: 50_000 });
  const car = goal({ id: 'car', target: 30_000, months: 6 });

  it('follows list order when nothing has been chosen', () => {
    const plan = fundGoals([house, car], 40_000, FX);
    expect(heldFor(plan, 'house')).toBe(40_000);
    expect(heldFor(plan, 'car')).toBe(0);
  });

  it('funds the chosen goal before the ones above it in the list', () => {
    const plan = fundGoals([house, car], 40_000, FX, 'car');
    expect(heldFor(plan, 'car')).toBe(30_000);
    expect(heldFor(plan, 'house')).toBe(10_000);
  });

  it('still reports the goals in the user list order', () => {
    const plan = fundGoals([house, car], 40_000, FX, 'car');
    expect(plan.goals.map((x) => x.goal.id)).toEqual(['house', 'car']);
  });

  it('allocates the same total either way — only the order changes', () => {
    const a = fundGoals([house, car], 40_000, FX);
    const b = fundGoals([house, car], 40_000, FX, 'car');
    expect(b.funded).toBe(a.funded);
    expect(b.free).toBe(a.free);
  });

  it('ignores a priority that names a goal which is not there', () => {
    const plan = fundGoals([house, car], 40_000, FX, 'gone');
    expect(heldFor(plan, 'house')).toBe(40_000);
  });
});
