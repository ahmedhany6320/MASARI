import { describe, expect, it } from 'vitest';
import real from './__fixtures__/backup-2026-08-14.json';
import { adaptiveOutlook } from './adaptive';
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
