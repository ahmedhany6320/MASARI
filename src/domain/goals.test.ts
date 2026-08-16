import { describe, expect, it } from 'vitest';
import { goalMonthlyRequirement, goalsMonthlyRequirement, isEgpGoal } from './goals';
import type { Goal } from './types';

const FX = 13.6;

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', ar: 'هدف', en: 'Goal', target: null, alloc: 0, months: null, auto: false, ...over };
}

describe('isEgpGoal', () => {
  it('honours an explicit currency', () => {
    expect(isEgpGoal(goal({ id: 'whatever', currency: 'EGP' }))).toBe(true);
    expect(isEgpGoal(goal({ id: 'egypt', currency: 'AED' }))).toBe(false);
  });

  it('falls back to the prototype id convention for legacy ledgers', () => {
    expect(isEgpGoal(goal({ id: 'egypt' }))).toBe(true);
    expect(isEgpGoal(goal({ id: 'emg' }))).toBe(false);
  });
});

describe('goalMonthlyRequirement', () => {
  it('demands nothing without a target', () => {
    expect(goalMonthlyRequirement(goal({ months: 12 }), FX)).toBe(0);
  });

  it('demands nothing without a deadline — a wish is not a commitment', () => {
    expect(goalMonthlyRequirement(goal({ target: 100000 }), FX)).toBe(0);
  });

  it('spreads an AED target evenly across the remaining months', () => {
    const g = goal({ id: 'emg', target: 12000, months: 12 });
    expect(goalMonthlyRequirement(g, FX)).toBe(1000);
  });

  it('subtracts what is already allocated', () => {
    const g = goal({ id: 'emg', target: 12000, alloc: 6000, months: 6 });
    expect(goalMonthlyRequirement(g, FX)).toBe(1000);
  });

  it('converts an EGP target at the FX rate', () => {
    const g = goal({ id: 'egypt', target: 1_050_000, months: 24 });
    expect(goalMonthlyRequirement(g, FX)).toBeCloseTo(1_050_000 / FX / 24, 6);
  });

  it('counts money already sitting in Egypt, converted', () => {
    const g = goal({ id: 'egypt', target: 1_050_000, extEgp: 250_000, months: 24 });
    expect(goalMonthlyRequirement(g, FX)).toBeCloseTo((1_050_000 - 250_000) / FX / 24, 6);
  });

  it('demands nothing once the goal is already met', () => {
    const g = goal({ id: 'emg', target: 10000, alloc: 15000, months: 6 });
    expect(goalMonthlyRequirement(g, FX)).toBe(0);
  });

  it('a weaker currency raises the monthly requirement', () => {
    const g = goal({ id: 'egypt', target: 1_050_000, months: 24 });
    expect(goalMonthlyRequirement(g, 10)).toBeGreaterThan(goalMonthlyRequirement(g, 20));
  });
});

describe('goalsMonthlyRequirement', () => {
  it('sums across goals', () => {
    const goals = [
      goal({ id: 'emg', target: 12000, months: 12 }),
      goal({ id: 'other', target: 6000, months: 12 }),
    ];
    expect(goalsMonthlyRequirement(goals, FX)).toBe(1500);
  });

  it('is zero for an empty list', () => {
    expect(goalsMonthlyRequirement([], FX)).toBe(0);
  });
});
