import { describe, expect, it } from 'vitest';
import { adaptDaily, adaptTarget, livingBand, type DailyInputs } from './adaptiveDaily';
import type { Goal } from './types';

const FX = 13.6;
const BAND = livingBand(20, 40);

function inputs(over: Partial<DailyInputs> = {}): DailyInputs {
  // 31-day month, 1,240 to live on: a clean 40/day at comfort.
  return {
    livingBudget: 1240, spent: 0, daysElapsed: 1, daysLeft: 31,
    daysInMonth: 31, band: BAND, ...over,
  };
}

describe('livingBand', () => {
  it('keeps the two figures in order', () => {
    expect(livingBand(20, 40)).toEqual({ min: 20, comfort: 40 });
  });

  it('tolerates them being entered the wrong way round', () => {
    // A comfort level below the floor is a slip, not an instruction to live
    // on less than the minimum.
    expect(livingBand(40, 20)).toEqual({ min: 20, comfort: 40 });
  });

  it('treats missing figures as zero', () => {
    expect(livingBand(null, null)).toEqual({ min: 0, comfort: 0 });
    expect(livingBand(-5, 30)).toEqual({ min: 0, comfort: 30 });
  });
});

describe('adaptDaily — overspending tightens the month, not the goal', () => {
  it('spreads an overspend across the days that remain', () => {
    // Day one: 200 spent against a 40 plan. The other 30 days share the 160.
    const d = adaptDaily(inputs({ spent: 200, daysElapsed: 1, daysLeft: 30 }));
    expect(d.onTrack).toBe(false);
    expect(d.today).toBeCloseTo((1240 - 200) / 30, 6);
    expect(d.today).toBeLessThan(40);
    // The goal is untouched: nothing was banked and nothing was absorbed.
    expect(d.bankedToGoal).toBe(0);
    expect(d.goalAbsorbed).toBe(0);
  });

  it('never prints a figure below the survival floor', () => {
    // Ruinous overspend: the even pace would be far under 20.
    const d = adaptDaily(inputs({ spent: 1200, daysElapsed: 20, daysLeft: 11 }));
    expect(d.today).toBe(20);
    expect(d.zone).toBe('floor');
  });

  it('charges that shortfall to the goal, and says how much', () => {
    const d = adaptDaily(inputs({ spent: 1200, daysElapsed: 20, daysLeft: 11 }));
    // 11 days at 20 is 220, against 40 left in the budget.
    expect(d.goalAbsorbed).toBeCloseTo(20 * 11 - (1240 - 1200), 6);
    expect(d.goalAbsorbed).toBeGreaterThan(0);
  });

  it('holds the floor even with the budget completely exhausted', () => {
    const d = adaptDaily(inputs({ spent: 5000, daysElapsed: 25, daysLeft: 6 }));
    expect(d.today).toBe(20);
    expect(Number.isFinite(d.today)).toBe(true);
  });
});

describe('adaptDaily — underspending is split in half', () => {
  it('banks half to the goal and leaves half available', () => {
    // Start of day 10: nine days have finished, so 360 was planned and 200
    // spent. 160 saved, half of it banked.
    const d = adaptDaily(inputs({ spent: 200, daysElapsed: 10, daysLeft: 21 }));
    expect(d.variance).toBeCloseTo(160, 6);
    expect(d.bankedToGoal).toBeCloseTo(80, 6);
    expect(d.livingBudget).toBeCloseTo(1160, 6);
  });

  it('banks nothing on day one, when nothing has been saved yet', () => {
    // An untouched allowance at the start of the month is not thrift.
    const d = adaptDaily(inputs({ spent: 0, daysElapsed: 1, daysLeft: 31 }));
    expect(d.variance).toBe(0);
    expect(d.bankedToGoal).toBe(0);
  });

  it('lifts the daily figure by the half that was kept', () => {
    const thrifty = adaptDaily(inputs({ spent: 200, daysElapsed: 10, daysLeft: 21 }));
    const onPlan = adaptDaily(inputs({ spent: 400, daysElapsed: 10, daysLeft: 21 }));
    expect(thrifty.today).toBeGreaterThan(onPlan.today);
    // But not by the whole saving — half of it has gone to the goal for good.
    expect(thrifty.today).toBeLessThan(onPlan.today + 200 / 21);
  });

  it('honours a different split when asked', () => {
    const all = adaptDaily(inputs({ spent: 200, daysElapsed: 10, daysLeft: 21, bankShare: 1 }));
    expect(all.bankedToGoal).toBeCloseTo(160, 6);
    const none = adaptDaily(inputs({ spent: 200, daysElapsed: 10, daysLeft: 21, bankShare: 0 }));
    expect(none.bankedToGoal).toBe(0);
  });

  it('banks nothing from an overspent month', () => {
    // Taking it from the goal as well as from the remaining days would charge
    // the same dirhams twice.
    expect(adaptDaily(inputs({ spent: 900, daysElapsed: 10, daysLeft: 21 })).bankedToGoal).toBe(0);
  });
});

describe('adaptDaily — the band says how the month is being lived', () => {
  it('calls a comfortable pace what it is', () => {
    const d = adaptDaily(inputs({ spent: 0, daysElapsed: 1, daysLeft: 31 }));
    expect(d.zone).toBe('comfort');
    expect(d.bandPosition).toBe(1);
  });

  it('names a month that is liveable but being endured', () => {
    const d = adaptDaily(inputs({ spent: 400, daysElapsed: 5, daysLeft: 26 }));
    expect(d.today).toBeGreaterThan(20);
    expect(d.today).toBeLessThan(40);
    expect(d.zone).toBe('tight');
    expect(d.bandPosition).toBeGreaterThan(0);
    expect(d.bandPosition).toBeLessThan(1);
  });

  it('says nothing at all when no band is set', () => {
    const d = adaptDaily(inputs({ band: livingBand(null, null) }));
    expect(d.zone).toBe('unset');
  });
});

describe('adaptTarget — the goal moves both ways', () => {
  const egypt: Goal = {
    id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
    target: 1_100_000, alloc: 0, months: 8, extEgp: 0, auto: true,
  };

  it('reports what this pace actually lands on', () => {
    const a = adaptTarget(egypt, 7745, 8, 0, FX);
    expect(a.achievable).toBeCloseTo(7745 * 8 * FX, 4);
    expect(a.reachesOriginal).toBe(false);
    expect(a.shortfall).toBeGreaterThan(0);
  });

  it('never rewrites the aspiration', () => {
    expect(adaptTarget(egypt, 100, 8, 0, FX).original).toBe(1_100_000);
  });

  it('caps the adapted figure at the aspiration', () => {
    // Overshooting is money left over, not a bigger goal.
    const a = adaptTarget(egypt, 99_999, 8, 0, FX);
    expect(a.adapted).toBe(1_100_000);
    expect(a.reachesOriginal).toBe(true);
    expect(a.progress).toBe(1);
  });

  it('rises when the pace improves', () => {
    const before = adaptTarget(egypt, 5000, 8, 0, FX);
    const after = adaptTarget(egypt, 7000, 8, 0, FX, before.adapted);
    expect(after.adapted).toBeGreaterThan(before.adapted);
    expect(after.drift).toBe('raised');
  });

  it('falls when it worsens', () => {
    const before = adaptTarget(egypt, 7000, 8, 0, FX);
    const after = adaptTarget(egypt, 5000, 8, 0, FX, before.adapted);
    expect(after.drift).toBe('lowered');
  });

  it('reports the aspiration coming back within reach', () => {
    // A windfall: the original was out of reach and now is not.
    const lean = adaptTarget(egypt, 5000, 8, 0, FX);
    const windfall = adaptTarget(egypt, 5000, 8, 60_000, FX, lean.adapted);
    expect(windfall.reachesOriginal).toBe(true);
    expect(windfall.drift).toBe('restored');
  });

  it('counts money already held toward it', () => {
    const bare = adaptTarget(egypt, 5000, 8, 0, FX);
    const withHeld = adaptTarget(egypt, 5000, 8, 20_000, FX);
    expect(withHeld.achievable).toBeGreaterThan(bare.achievable);
  });

  it('handles an AED goal without applying a rate', () => {
    const aed: Goal = { ...egypt, currency: 'AED', target: 80_000 };
    expect(adaptTarget(aed, 5000, 8, 0, FX).achievable).toBe(40_000);
  });

  it('survives a goal with no target at all', () => {
    const none: Goal = { ...egypt, target: null };
    const a = adaptTarget(none, 5000, 8, 0, FX);
    expect(a.original).toBe(0);
    expect(a.progress).toBe(1);
    expect(Number.isFinite(a.achievable)).toBe(true);
  });
});
