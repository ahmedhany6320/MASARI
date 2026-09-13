import { describe, expect, it } from 'vitest';
import real from './__fixtures__/backup-2026-08-14.json';
import { emptyLedger } from './defaults';
import { importBackup } from './importBackup';
import {
  burnRate,
  categoryStats,
  detectRecurring,
  goalProjection,
  merchantStats,
  monthComparison,
  underLimitStreak,
  weekdayStats,
} from './insights';
import type { Goal, Ledger, Tx } from './types';

const NOW = new Date(2026, 7, 14, 12, 0, 0);
const MONTH_START = new Date(2026, 7, 1).getTime();

let seq = 0;
function spend(amt: number, ts: number, merchant?: string, cat?: string): Tx {
  return { id: `x${seq++}`, ts, type: 'expense', acct: 'card', amt, m: merchant, cat: cat ?? null };
}
function ledger(over: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(), base: 11000, ...over };
}

describe('merchantStats — against the real backup', () => {
  const { ledger: real14 } = importBackup(real);
  const stats = merchantStats(real14, MONTH_START);

  it('ranks the biggest merchant first', () => {
    expect(stats[0]?.name).toBe('Mango');
    expect(stats[0]?.total).toBeCloseTo(199.82, 2);
  });

  it('counts repeat visits', () => {
    const famous = stats.find((m) => m.name.trim() === 'Famous');
    expect(famous?.count).toBe(11);
    expect(famous?.total).toBeCloseTo(194.9, 2);
  });

  it('computes the average ticket', () => {
    const famous = stats.find((m) => m.name.trim() === 'Famous');
    expect(famous?.average).toBeCloseTo(194.9 / 11, 2);
  });

  it('reports each merchant share of total spending', () => {
    const sum = stats.reduce((a, m) => a + m.share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('groups case-insensitively', () => {
    const s = merchantStats(
      ledger({ tx: [spend(10, MONTH_START, 'Mango'), spend(10, MONTH_START, 'mango')] }),
      MONTH_START,
    );
    expect(s).toHaveLength(1);
    expect(s[0]?.count).toBe(2);
  });

  it('ignores entries with no merchant recorded', () => {
    const s = merchantStats(ledger({ tx: [spend(10, MONTH_START)] }), MONTH_START);
    expect(s).toHaveLength(0);
  });
});

describe('categoryStats', () => {
  const { ledger: real14 } = importBackup(real);

  it('ranks categories by spend', () => {
    const stats = categoryStats(real14, MONTH_START);
    expect(stats[0]?.id).toBe('c2'); // restaurants
    expect(stats[0]?.total).toBeCloseTo(331.44, 2);
    expect(stats[1]?.id).toBe('c1'); // groceries
  });

  it('shares sum to one', () => {
    const stats = categoryStats(real14, MONTH_START);
    expect(stats.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 5);
  });

  it('groups uncategorised spending under null', () => {
    const stats = categoryStats(ledger({ tx: [spend(10, MONTH_START, 'x')] }), MONTH_START);
    expect(stats[0]?.id).toBeNull();
  });
});

describe('weekdayStats', () => {
  it('averages per occurrence of that weekday, not per hit', () => {
    // Two Mondays in the window, spending on only one of them.
    const monday1 = new Date(2026, 7, 3, 12).getTime();
    const monday2 = new Date(2026, 7, 10, 12).getTime();
    const s = weekdayStats(
      ledger({ tx: [spend(100, monday1, 'a')] }),
      new Date(2026, 7, 1).getTime(),
      new Date(2026, 7, 11, 12),
    );
    const monday = s[1];
    expect(monday?.total).toBe(100);
    expect(monday?.average).toBe(50); // 100 across two Mondays
    expect(monday2).toBeGreaterThan(monday1);
  });

  it('always returns all seven days', () => {
    expect(weekdayStats(ledger(), MONTH_START, NOW)).toHaveLength(7);
  });
});

describe('burnRate', () => {
  const { ledger: real14 } = importBackup(real);

  it('divides by days elapsed, not by days with spending', () => {
    const b = burnRate(real14, 11000, NOW);
    expect(b.days).toBe(14);
    expect(b.total).toBeCloseTo(681.81, 2);
    expect(b.perDay).toBeCloseTo(681.81 / 14, 2);
    // Spending happened on fewer days than have elapsed.
    expect(b.activeDays).toBeLessThan(b.days);
  });

  it('projects the month at the current pace', () => {
    const b = burnRate(real14, 11000, NOW);
    expect(b.projectedMonth).toBeCloseTo((681.81 / 14) * 31, 2);
  });

  it('reports a negative overrun when comfortably inside the pool', () => {
    const b = burnRate(real14, 11000, NOW);
    expect(b.projectedOverrun).toBeLessThan(0);
  });

  it('reports a positive overrun when heading past the pool', () => {
    const heavy = ledger({ tx: [spend(9000, MONTH_START + 86400e3, 'x')] });
    expect(burnRate(heavy, 5000, NOW).projectedOverrun).toBeGreaterThan(0);
  });
});

describe('goalProjection', () => {
  const egypt: Goal = {
    id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
    target: 1_100_000, alloc: 0, months: null, extEgp: 0, auto: false,
  };

  it('turns a deadline-less target into a real date from actual saving', () => {
    // 8,000 AED/month at 13.6 = 108,800 EGP/month.
    const p = goalProjection(egypt, 8000, 13.6, NOW);
    expect(p.remaining).toBe(1_100_000);
    expect(p.monthsAtCurrentPace).toBeCloseTo(1_100_000 / (8000 * 13.6), 4);
    expect(p.eta).not.toBeNull();
  });

  it('says never rather than inventing a date when nothing is being saved', () => {
    const p = goalProjection(egypt, 0, 13.6, NOW);
    expect(p.monthsAtCurrentPace).toBeNull();
    expect(p.eta).toBeNull();
  });

  it('says never when saving is negative', () => {
    expect(goalProjection(egypt, -500, 13.6, NOW).monthsAtCurrentPace).toBeNull();
  });

  it('counts money already sitting in Egypt', () => {
    const p = goalProjection({ ...egypt, extEgp: 100_000 }, 8000, 13.6, NOW);
    expect(p.remaining).toBe(1_000_000);
  });

  it('flags being behind the user own deadline', () => {
    const p = goalProjection({ ...egypt, months: 6 }, 8000, 13.6, NOW);
    expect(p.behindSchedule).toBe(true);
  });

  it('is not behind schedule when the pace beats the deadline', () => {
    const p = goalProjection({ ...egypt, months: 60 }, 8000, 13.6, NOW);
    expect(p.behindSchedule).toBe(false);
  });

  it('reports an already-met goal as zero months, not never', () => {
    const p = goalProjection({ ...egypt, extEgp: 1_200_000 }, 0, 13.6, NOW);
    expect(p.remaining).toBe(0);
    expect(p.monthsAtCurrentPace).toBe(0);
  });

  it('handles an AED goal without converting', () => {
    const emg: Goal = {
      id: 'emg', ar: 'طوارئ', en: 'Emergency', currency: 'AED',
      target: 20000, alloc: 5000, months: null, auto: false,
    };
    const p = goalProjection(emg, 3000, 13.6, NOW);
    expect(p.remaining).toBe(15000);
    expect(p.monthsAtCurrentPace).toBe(5);
  });
});

describe('detectRecurring', () => {
  it('needs at least three charges — two is a coincidence', () => {
    const tx = [
      spend(80, new Date(2026, 5, 1).getTime(), 'Claude'),
      spend(80, new Date(2026, 6, 1).getTime(), 'Claude'),
    ];
    expect(detectRecurring(ledger({ tx }), NOW)).toHaveLength(0);
  });

  it('detects a steady monthly charge', () => {
    const tx = [
      spend(79.55, new Date(2026, 4, 2).getTime(), 'Claude'),
      spend(79.55, new Date(2026, 5, 2).getTime(), 'Claude'),
      spend(79.55, new Date(2026, 6, 2).getTime(), 'Claude'),
    ];
    const found = detectRecurring(ledger({ tx }), NOW);
    expect(found).toHaveLength(1);
    expect(found[0]?.monthly).toBe(true);
    expect(found[0]?.amount).toBeCloseTo(79.55, 2);
  });

  it('ignores a shop visited often — that is habit, not a subscription', () => {
    const tx = Array.from({ length: 10 }, (_, i) =>
      spend(13.5, new Date(2026, 7, i + 1).getTime(), 'Famous'),
    );
    expect(detectRecurring(ledger({ tx }), NOW)).toHaveLength(0);
  });

  it('ignores a monthly merchant whose amount swings wildly', () => {
    const tx = [
      spend(50, new Date(2026, 4, 2).getTime(), 'Shop'),
      spend(300, new Date(2026, 5, 2).getTime(), 'Shop'),
      spend(120, new Date(2026, 6, 2).getTime(), 'Shop'),
    ];
    expect(detectRecurring(ledger({ tx }), NOW)).toHaveLength(0);
  });
});

describe('underLimitStreak', () => {
  it('counts consecutive days that stayed inside the allowance', () => {
    const tx = [
      spend(50, new Date(2026, 7, 13, 12).getTime(), 'a'),
      spend(60, new Date(2026, 7, 12, 12).getTime(), 'a'),
      spend(70, new Date(2026, 7, 11, 12).getTime(), 'a'),
    ];
    expect(underLimitStreak(ledger({ tx }), 100, NOW)).toBeGreaterThanOrEqual(3);
  });

  it('breaks on the first day that went over', () => {
    const tx = [
      spend(50, new Date(2026, 7, 13, 12).getTime(), 'a'),
      spend(500, new Date(2026, 7, 12, 12).getTime(), 'a'),
    ];
    expect(underLimitStreak(ledger({ tx }), 100, NOW)).toBe(1);
  });

  it("ignores today, because the day is not over", () => {
    const tx = [spend(9999, new Date(2026, 7, 14, 9).getTime(), 'a')];
    expect(underLimitStreak(ledger({ tx }), 100, NOW)).toBeGreaterThan(0);
  });

  it('is zero when there is no allowance to stay inside', () => {
    expect(underLimitStreak(ledger(), 0, NOW)).toBe(0);
  });
});

describe('monthComparison', () => {
  it('compares like for like, truncating last month at the same day', () => {
    const tx = [
      spend(100, new Date(2026, 7, 5).getTime(), 'a'),
      spend(500, new Date(2026, 6, 5).getTime(), 'a'),
      // After the 14th last month, so excluded from the to-date figure.
      spend(900, new Date(2026, 6, 25).getTime(), 'a'),
    ];
    const c = monthComparison(ledger({ tx }), NOW);
    expect(c.thisMonth).toBe(100);
    expect(c.lastMonth).toBe(1400);
    expect(c.lastMonthToDate).toBe(500);
    expect(c.change).toBeCloseTo((100 - 500) / 500, 5);
  });

  it('reports no change when there is no prior month to compare', () => {
    const c = monthComparison(ledger({ tx: [spend(100, new Date(2026, 7, 5).getTime(), 'a')] }), NOW);
    expect(c.change).toBeNull();
  });
});
