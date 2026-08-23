import { describe, expect, it } from 'vitest';
import real from './__fixtures__/backup-2026-08-14.json';
import {
  adaptiveHorizon,
  adaptiveOutlook,
  dailyForTarget,
  horizonTracker,
  planDrift,
  reserveForGoal,
} from './adaptive';
import { emptyLedger } from './defaults';
import type { Capacity } from './goalPlan';
import { importBackup } from './importBackup';
import { safeSpend } from './safeSpend';
import type { Goal } from './types';

const FX = 13.6;
const NOW = new Date(2026, 7, 14, 12, 0, 0);

const egypt: Goal = {
  id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
  target: 1_100_000, alloc: 0, months: null, extEgp: 0, auto: false,
};

/** Mirrors the real ledger: 9,714 pool, 1,470 projected spend. */
const cap: Capacity = { poolBeforeGoal: 9714, projectedSpend: 1470, saving: 8244, daysInMonth: 31 };

describe('reserveForGoal — the floor wins', () => {
  it('gives the goal everything above the floor', () => {
    const r = reserveForGoal(5000, 9714, 50, 31);
    expect(r.floorMonthly).toBe(1550);
    expect(r.reserved).toBe(5000);
    expect(r.capped).toBe(false);
  });

  it('caps a greedy goal rather than starving the month', () => {
    const r = reserveForGoal(9000, 9714, 50, 31);
    expect(r.reserved).toBe(9714 - 1550);
    expect(r.capped).toBe(true);
    expect(r.heldBack).toBeCloseTo(9000 - 8164, 6);
  });

  it('reserves nothing when the floor already exceeds the pool', () => {
    expect(reserveForGoal(5000, 1000, 100, 31).reserved).toBe(0);
  });

  it('behaves like plain fixed mode when no floor is set', () => {
    expect(reserveForGoal(5000, 9714, 0, 31).capped).toBe(false);
  });
});

describe('safeSpend — the daily limit never falls below the floor', () => {
  it('caps the goal so the pool honours the floor', () => {
    const s = {
      ...emptyLedger(),
      base: 11000,
      minDailySpend: 60,
      goals: [{ ...egypt, months: 6 }],
    };
    const c = safeSpend(s, FX, NOW);
    expect(c.goalAsked).toBeGreaterThan(c.goalReq);
    expect(c.goalHeldBack).toBeGreaterThan(0);
    expect(c.livingPool).toBeCloseTo(60 * 31, 6);
  });

  it('leaves a goal that fits above the floor untouched', () => {
    const s = {
      ...emptyLedger(),
      base: 11000,
      minDailySpend: 50,
      goals: [{ ...egypt, currency: 'AED' as const, target: 12000, months: 12 }],
    };
    const c = safeSpend(s, FX, NOW);
    expect(c.goalHeldBack).toBe(0);
    expect(c.goalReq).toBe(1000);
  });

  it('still caps at the pool with no floor — a goal cannot reserve money that does not exist', () => {
    const c = safeSpend({ ...emptyLedger(), base: 11000, goals: [{ ...egypt, months: 6 }] }, FX, NOW);
    expect(c.floorMonthly).toBe(0);
    // The schedule wants more than the whole salary, so it is trimmed to it.
    expect(c.goalAsked).toBeGreaterThan(c.goalReq);
    expect(c.goalReq).toBe(11000);
    // The living pool bottoms out at zero rather than going negative, which is
    // what the old uncapped version did.
    expect(c.livingPool).toBe(0);
    expect(c.ssl).toBe(0);
  });

  it('does not touch a goal that comfortably fits, floor or no floor', () => {
    const modest = { ...egypt, currency: 'AED' as const, target: 6000, months: 12 };
    const c = safeSpend({ ...emptyLedger(), base: 11000, goals: [modest] }, FX, NOW);
    expect(c.goalHeldBack).toBe(0);
    expect(c.goalReq).toBe(500);
  });
});

describe('adaptiveOutlook', () => {
  const out = adaptiveOutlook(egypt, cap, 50, FX);

  it('caps saving at what the floor leaves', () => {
    expect(out.maxSavingAed).toBe(9714 - 1550);
  });

  it('keeps the aspiration rather than rewriting it', () => {
    expect(out.aspiration).toBe(1_100_000);
  });

  it('is not viable when the floor swallows the pool', () => {
    const poor = adaptiveOutlook(egypt, { ...cap, poolBeforeGoal: 1000 }, 50, FX);
    expect(poor.viable).toBe(false);
    expect(poor.monthsAtMax).toBeNull();
  });
});

describe('adaptiveHorizon — stretch mode', () => {
  const out = adaptiveOutlook(egypt, cap, 50, FX);

  it('reports the honest landing point for a short horizon', () => {
    const h = adaptiveHorizon(out, 8);
    expect(h.reachesAspiration).toBe(false);
    expect(h.gap).toBeGreaterThan(0);
  });

  it('suggests the reachable figure instead of one set up to fail', () => {
    const h = adaptiveHorizon(out, 8);
    expect(h.suggestedTarget).toBe(h.best);
    expect(h.suggestedTarget).toBeLessThan(out.aspiration);
  });

  it('keeps the aspiration once the horizon is long enough', () => {
    expect(adaptiveHorizon(out, 24).suggestedTarget).toBe(1_100_000);
  });
});

describe('horizonTracker — fix the DATE, watch the amount move', () => {
  const track = horizonTracker(egypt, cap, 50, 8, FX, NOW);

  it('holds the date and derives the amount', () => {
    expect(track.months).toBe(8);
    expect(track.targetDate.getMonth()).toBe(3); // Aug + 8 = April
    expect(track.targetDate.getFullYear()).toBe(2027);
    expect(track.projected).toBeGreaterThan(0);
  });

  it('answers "how much will I have by then" rather than refusing', () => {
    expect(track.reachesAspiration).toBe(false);
    expect(track.gap).toBeGreaterThan(0);
    // Roughly 80% of the ambition, which is a position, not a wall.
    expect(track.progress).toBeGreaterThan(0.75);
    expect(track.progress).toBeLessThan(0.9);
  });

  it('gives a floor case and a ceiling case around the projection', () => {
    expect(track.projectedAtFloor).toBeLessThanOrEqual(track.projectedIfNoSpend);
    expect(track.projectedIfNoSpend).toBeGreaterThan(track.projected);
  });

  it('moves day by day as the deadline approaches', () => {
    const later = horizonTracker(egypt, cap, 50, 8, FX, new Date(2026, 7, 24, 12));
    // Ten days on, ten days less saving remains before the same-length window.
    expect(later.monthsRemaining).toBeCloseTo(track.monthsRemaining, 1);
    expect(later.targetDate.getTime()).toBeGreaterThan(track.targetDate.getTime());
  });

  it('shrinks the remaining window as the fixed date nears', () => {
    const fixedDate = (now: Date, months: number) => horizonTracker(egypt, cap, 50, months, FX, now);
    const near = fixedDate(NOW, 1);
    const far = fixedDate(NOW, 12);
    expect(near.monthsRemaining).toBeLessThan(far.monthsRemaining);
    expect(near.projected).toBeLessThan(far.projected);
  });

  it('credits underspending today straight to the projection', () => {
    const under = horizonTracker(egypt, cap, 50, 8, FX, NOW, 20, 60);
    const over = horizonTracker(egypt, cap, 50, 8, FX, NOW, 90, 60);
    expect(under.todayImpact).toBeGreaterThan(0);
    expect(over.todayImpact).toBeLessThan(0);
  });

  it('prices one dirham a day so a cut has a visible payoff', () => {
    expect(track.perDirhamPerDay).toBeGreaterThan(0);
    // Saving 10/day should move the landing figure meaningfully.
    expect(track.perDirhamPerDay * 10).toBeGreaterThan(1000);
  });

  it('reports reaching the aspiration on a long enough date', () => {
    expect(horizonTracker(egypt, cap, 50, 36, FX, NOW).reachesAspiration).toBe(true);
  });
});

describe('dailyForTarget', () => {
  it('returns the daily allowance a reachable target implies', () => {
    expect(dailyForTarget(egypt, 1_100_000, 24, cap, 50, FX)).toBeGreaterThan(50);
  });

  it('returns null rather than a figure below the floor', () => {
    expect(dailyForTarget(egypt, 1_100_000, 8, cap, 50, FX)).toBeNull();
  });

  it('never divides by zero months', () => {
    expect(() => dailyForTarget(egypt, 1000, 0, cap, 50, FX)).not.toThrow();
  });
});

describe('planDrift', () => {
  const out = adaptiveOutlook(egypt, cap, 50, FX);

  it('is on track at or under plan', () => {
    expect(planDrift(out, 60, 55, cap, 12).onTrack).toBe(true);
  });

  it('pushes the date out when overspending', () => {
    expect(planDrift(out, 60, 90, cap, 12).monthsSlip!).toBeGreaterThan(0);
  });

  it('pulls it in when underspending', () => {
    expect(planDrift(out, 60, 30, cap, 12).monthsSlip!).toBeLessThan(0);
  });

  it('compounds daily drift across the month', () => {
    expect(planDrift(out, 60, 70, cap, 12).driftMonthly).toBe(10 * 31);
  });
});

describe('adaptive against the real backup', () => {
  const { ledger, settings } = importBackup(real);
  const withDeadline = ledger.goals.map((g) => (g.id === 'egypt' ? { ...g, months: 8 } : g));

  it('counts the balance as progress the goal has already made', () => {
    // The goal draws from the account, so the 23,255 held is not "nothing
    // saved" — it is a third of the way there, and the deadline demands
    // correspondingly less each month.
    const c = safeSpend({ ...ledger, goals: withDeadline }, settings.fxRate, NOW);
    expect(c.funding.funded).toBe(c.liquid);
    expect(c.goalAsked).toBeCloseTo(7203.42, 2);
    expect(c.ssl).toBeGreaterThan(0);
  });

  it('demands far more of a goal credited with nothing', () => {
    // The same deadline against an empty account: the contrast is exactly what
    // funding from the balance fixes.
    const broke = { ...ledger, goals: withDeadline, bankOpen: 0, cashOpen: 0, tx: [] };
    const c = safeSpend(broke, settings.fxRate, NOW);
    expect(c.funding.funded).toBe(0);
    // The full 1,100,000 EGP over 8 months, with nothing credited against it.
    expect(c.goalAsked).toBeCloseTo(1_100_000 / settings.fxRate / 8, 2);
    expect(c.goalAsked).toBeGreaterThan(10000);
    expect(c.ssl).toBe(0);
  });

  it('still caps a goal that outruns the pool, and says so', () => {
    // Two months instead of eight: now the ask genuinely exceeds what is
    // there, the floor holds part of it back, and the limit stays livable.
    const rush = ledger.goals.map((g) => (g.id === 'egypt' ? { ...g, months: 2 } : g));
    const c = safeSpend(
      { ...ledger, goals: rush, minDailySpend: 60 },
      settings.fxRate,
      NOW,
    );
    expect(c.goalHeldBack).toBeGreaterThan(0);
    expect(c.ssl).toBeGreaterThan(0);
  });
});
