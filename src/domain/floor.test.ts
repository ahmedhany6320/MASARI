import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import {
  dailyTotals,
  percentile,
  recommendBuffer,
  recommendFloor,
  spendProfile,
  trimmedMean,
} from './floor';
import type { Ledger, Tx } from './types';

const NOW = new Date(2026, 7, 31, 12, 0, 0);

let seq = 0;
/** An expense `daysAgo` days before NOW. */
function spend(amt: number, daysAgo: number): Tx {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return { id: `x${seq++}`, ts: d.getTime(), type: 'expense', acct: 'card', amt };
}
function led(tx: Tx[] = []): Ledger {
  return { ...emptyLedger(), tx };
}
/** `n` consecutive days each costing `amt`, ending `offset` days ago. */
function run(amt: number, n: number, offset = 0): Tx[] {
  return Array.from({ length: n }, (_, i) => spend(amt, offset + i));
}

describe('percentile', () => {
  it('interpolates between samples', () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([0, 100], 0.75)).toBe(75);
  });

  it('handles the degenerate sizes', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([42], 0.9)).toBe(42);
  });

  it('clamps a percentile outside 0–1', () => {
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 5)).toBe(3);
  });

  it('does not care about input order', () => {
    expect(percentile([9, 1, 5], 0.5)).toBe(percentile([1, 5, 9], 0.5));
  });
});

describe('dailyTotals — quiet days are days too', () => {
  it('counts a day with no spending as zero, not as absent', () => {
    // Two spending days inside a five-day window: the other three are zeros,
    // and dropping them would measure only the busy half of the month.
    const s = led([spend(100, 1), spend(50, 3)]);
    const totals = dailyTotals(s, NOW.getTime() - 5 * 864e5, NOW.getTime());
    expect(totals.filter((x) => x === 0).length).toBeGreaterThan(0);
    expect(totals.reduce((a, x) => a + x, 0)).toBe(150);
  });

  it('adds up several expenses on one day', () => {
    const s = led([spend(30, 2), spend(70, 2)]);
    const totals = dailyTotals(s, NOW.getTime() - 4 * 864e5, NOW.getTime());
    expect(totals).toContain(100);
  });

  it('ignores anything outside the window', () => {
    const s = led([spend(500, 200)]);
    expect(dailyTotals(s, NOW.getTime() - 10 * 864e5, NOW.getTime())
      .reduce((a, x) => a + x, 0)).toBe(0);
  });

  it('ignores income and transfers — only spending shapes a spending floor', () => {
    const s = led([
      spend(100, 1),
      { id: 'i', ts: NOW.getTime() - 864e5, type: 'income', acct: 'bank', amt: 9000 },
      { id: 'r', ts: NOW.getTime() - 864e5, type: 'remit', acct: 'bank', amt: 3000 },
    ]);
    expect(dailyTotals(s, NOW.getTime() - 5 * 864e5, NOW.getTime())
      .reduce((a, x) => a + x, 0)).toBe(100);
  });
});

describe('spendProfile — the shape of a month, not just its average', () => {
  it('separates an ordinary day, a costly one, and a bad one', () => {
    // A realistic month: mostly quiet, some heavier days, a few spikes.
    const s = led([...run(50, 20, 10), ...run(150, 6, 4), ...run(400, 4)]);
    const p = spendProfile(s, NOW, 30);
    expect(p.typical).toBe(50);
    expect(p.comfortable).toBe(150);
    expect(p.bad).toBe(400);
    expect(p.worst).toBe(400);
  });

  it('reports the mean as well, which is the figure that misleads', () => {
    const s = led([...run(50, 20, 10), ...run(150, 6, 4), ...run(400, 4)]);
    const p = spendProfile(s, NOW, 30);
    // The average sits between the ordinary day and the bad one, describing
    // neither — which is exactly why a floor is not built from it.
    expect(p.mean).toBeGreaterThan(p.typical);
    expect(p.mean).toBeLessThan(p.worst);
  });

  it('counts quiet days', () => {
    const s = led(run(100, 10));
    const p = spendProfile(s, NOW, 30);
    expect(p.quietDays).toBeGreaterThan(15);
  });

  it('flags history too thin to conclude anything from', () => {
    expect(spendProfile(led(run(100, 3)), NOW, 90).thin).toBe(true);
    expect(spendProfile(led(), NOW, 90).thin).toBe(true);
  });

  it('does not flag a full, active window', () => {
    expect(spendProfile(led(run(60, 60)), NOW, 90).thin).toBe(false);
  });
});

describe('recommendFloor — measured, not remembered', () => {
  it('sets the floor so most days fit inside it', () => {
    const s = led([...run(50, 20, 10), ...run(150, 6, 4), ...run(400, 4)]);
    const a = recommendFloor(s, NOW, 30);
    expect(a.basis).toBe('measured');
    expect(a.coverage).toBeGreaterThanOrEqual(0.75);
  });

  it('sits above the typical day, not on it', () => {
    // A floor met on exactly half of days guarantees running short every
    // other day, and those shortfalls compound across the month.
    const s = led([...run(40, 20, 10), ...run(120, 10)]);
    const a = recommendFloor(s, NOW, 30);
    expect(a.floor).toBeGreaterThan(a.profile.typical);
  });

  it('measures the overshoot a flat floor fails to provide', () => {
    const s = led([...run(50, 20, 10), ...run(150, 6, 4), ...run(400, 4)]);
    const a = recommendFloor(s, NOW, 30);
    expect(a.daysOver).toBeGreaterThan(0);
    expect(a.overflow).toBeGreaterThan(0);
  });

  it('says it is guessing when history is thin', () => {
    expect(recommendFloor(led(run(100, 5)), NOW, 90).basis).toBe('thin-history');
  });

  it('recommends nothing at all from an empty ledger', () => {
    const a = recommendFloor(led(), NOW, 90);
    expect(a.basis).toBe('none');
    expect(a.floor).toBe(0);
  });

  it('is not dragged upward by one catastrophic day', () => {
    // A percentile ignores a lone outlier; a mean would not.
    const calm = led(run(50, 60));
    const shocked = led([...run(50, 59, 1), spend(9000, 0)]);
    const a = recommendFloor(calm, NOW, 60).floor;
    const b = recommendFloor(shocked, NOW, 60).floor;
    expect(b).toBeCloseTo(a, 0);
  });
});

describe('recommendBuffer — the money has to actually be there', () => {
  const volatile = led([...run(50, 20, 10), ...run(150, 6, 4), ...run(400, 4)]);
  const advice = recommendFloor(volatile, NOW, 30);

  it('sizes the reserve from real overshoot, not from a rule of thumb', () => {
    const b = recommendBuffer(advice, 0, 30);
    expect(b.target).toBeGreaterThan(0);
    expect(b.shortfall).toBe(b.target);
    expect(b.funded).toBe(false);
  });

  it('never sizes below one month of ordinary living', () => {
    // Smooth recorded spending says nothing about future risk; it is a fact
    // about the sample, so a minimum still applies.
    const smooth = led(run(60, 60));
    const a = recommendFloor(smooth, NOW, 60);
    const b = recommendBuffer(a, 0, 30);
    expect(b.target).toBeGreaterThanOrEqual(a.floor * 30);
    expect(b.monthsCovered).toBeGreaterThanOrEqual(1);
  });

  it('counts money already held toward it', () => {
    const b = recommendBuffer(advice, 100_000, 30);
    expect(b.funded).toBe(true);
    expect(b.shortfall).toBe(0);
    expect(b.monthly).toBe(0);
    expect(b.ratio).toBe(1);
  });

  it('spreads the shortfall instead of demanding it all at once', () => {
    const b = recommendBuffer(advice, 0, 30, 6);
    expect(b.monthly).toBeCloseTo(b.shortfall / 6, 6);
    expect(b.monthly).toBeLessThan(b.target);
  });

  it('treats an overdrawn balance as nothing held', () => {
    const b = recommendBuffer(advice, -2000, 30);
    expect(b.held).toBe(0);
    expect(b.shortfall).toBe(b.target);
  });

  it('reports partial progress honestly', () => {
    const full = recommendBuffer(advice, 0, 30).target;
    const b = recommendBuffer(advice, full / 2, 30);
    expect(b.ratio).toBeCloseTo(0.5, 6);
    expect(b.funded).toBe(false);
  });
});

describe('sparse recording cannot be mistaken for cheap living', () => {
  // The real case that caught this: 11 spending days out of 91. Three quarters
  // of the sample is zero, so a plain percentile recommends a floor of nothing
  // — confidently, from real data, and completely useless.
  const sparse = led([
    ...run(60, 4, 80), ...run(45, 3, 40), ...run(120, 4, 10),
  ]);

  it('never recommends a floor of zero while spending exists', () => {
    const a = recommendFloor(sparse, NOW, 90);
    expect(a.profile.comfortable).toBe(0);
    expect(a.floor).toBeGreaterThan(0);
  });

  it('says the history is too thin to trust', () => {
    const a = recommendFloor(sparse, NOW, 90);
    expect(a.profile.density).toBeLessThan(0.4);
    expect(a.basis).toBe('thin-history');
  });

  it('trusts a densely recorded window instead', () => {
    const a = recommendFloor(led(run(60, 80)), NOW, 90);
    expect(a.profile.density).toBeGreaterThan(0.8);
    expect(a.basis).toBe('measured');
  });
});

describe('trimmedMean', () => {
  it('discards the worst days before averaging', () => {
    const withSpike = [...Array(19).fill(10), 10_000];
    expect(trimmedMean(withSpike, 0.05)).toBe(10);
  });

  it('equals the plain mean when nothing is trimmed', () => {
    expect(trimmedMean([10, 20, 30], 0)).toBe(20);
  });

  it('never discards every sample', () => {
    expect(trimmedMean([7], 0.9)).toBe(7);
    expect(trimmedMean([], 0.5)).toBe(0);
  });
})
