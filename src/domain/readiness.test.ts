import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { analyticsReadiness } from './readiness';
import type { Ledger, Tx } from './types';

const NOW = new Date(2026, 8, 12, 12, 0, 0);

let seq = 0;
function spend(daysAgo: number, amt = 50): Tx {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  return { id: `x${seq++}`, ts: d.getTime(), type: 'expense', acct: 'card', amt };
}
function led(tx: Tx[]): Ledger {
  return { ...emptyLedger(), tx };
}

describe('analyticsReadiness — refuse to conclude from nothing', () => {
  it('calls the real ledger what it is: too thin', () => {
    // The reported case: eleven spending days out of ninety-one.
    const sparse = led(Array.from({ length: 11 }, (_, i) => spend(i * 8)));
    const r = analyticsReadiness(sparse, NOW);
    expect(r.density).toBeLessThan(0.25);
    expect(r.overall).toBe('insufficient');
  });

  it('holds the weekday view to the strictest bar', () => {
    // Seven buckets across eleven entries is about one and a half each:
    // whichever day comes out highest is noise reported as a habit.
    const sparse = led(Array.from({ length: 11 }, (_, i) => spend(i * 8)));
    expect(analyticsReadiness(sparse, NOW).weekday).toBe('insufficient');
  });

  it('lets merchants through before weekday patterns', () => {
    const some = led(Array.from({ length: 14 }, (_, i) => spend(i * 2)));
    const r = analyticsReadiness(some, NOW);
    expect(r.merchants).not.toBe('insufficient');
    expect(r.weekday).toBe('insufficient');
  });

  it('clears everything once recording is dense', () => {
    const dense = led(Array.from({ length: 80 }, (_, i) => spend(i)));
    const r = analyticsReadiness(dense, NOW);
    expect(r.overall).toBe('good');
    expect(r.weekday).toBe('good');
    expect(r.merchants).toBe('good');
  });

  it('blocks a comparison against a month nobody recorded', () => {
    // "Spending down 94%" against an empty month is the absence of a finding,
    // and it reads as the opposite of the truth.
    // All inside September, so August genuinely holds nothing. Spreading
    // these over 20 days would reach back into August and defeat the point.
    const thisMonthOnly = led(Array.from({ length: 20 }, (_, i) => spend(i % 10)));
    const r = analyticsReadiness(thisMonthOnly, NOW);
    expect(r.previousMonthEntries).toBe(0);
    expect(r.monthCompare).toBe('insufficient');
  });

  it('allows it once the previous month has real entries', () => {
    const both = led([
      ...Array.from({ length: 20 }, (_, i) => spend(i)),
      ...Array.from({ length: 20 }, (_, i) => spend(20 + i)),
    ]);
    expect(analyticsReadiness(both, NOW).monthCompare).not.toBe('insufficient');
  });

  it('says nothing at all about an empty ledger', () => {
    const r = analyticsReadiness(led([]), NOW);
    expect(r.overall).toBe('insufficient');
    expect(r.entries).toBe(0);
    expect(r.density).toBe(0);
  });
});
