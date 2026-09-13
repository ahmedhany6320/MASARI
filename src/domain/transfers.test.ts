import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { annualFeeCost, transferStats, transferSummary } from './transfers';
import type { Ledger, Tx } from './types';

const SINCE = new Date(2026, 6, 1).getTime();
const FALLBACK = 13.6;

let seq = 0;
function remit(amt: number, over: Partial<Tx> = {}): Tx {
  return { id: `r${seq++}`, ts: new Date(2026, 7, 1).getTime(), type: 'remit', amt, ...over };
}
function ledger(tx: Tx[]): Ledger {
  return { ...emptyLedger(), tx };
}

describe('transferStats', () => {
  it('groups by recipient, biggest first', () => {
    const s = transferStats(
      ledger([
        remit(500, { to: 'الخطيبة' }),
        remit(300, { to: 'الوالدة' }),
        remit(200, { to: 'الخطيبة' }),
      ]),
      SINCE,
      FALLBACK,
    );
    expect(s[0]?.to).toBe('الخطيبة');
    expect(s[0]?.sent).toBe(700);
    expect(s[0]?.count).toBe(2);
  });

  it('reports the amount that reached them, net of the fee', () => {
    const s = transferStats(ledger([remit(515, { to: 'X', fee: 15 })]), SINCE, FALLBACK);
    expect(s[0]?.sent).toBe(500);
    expect(s[0]?.fees).toBe(15);
    expect(s[0]?.feeRate).toBeCloseTo(15 / 500, 6);
  });

  it('converts at the rate stored on each transfer, not today’s', () => {
    // Today's rate is 13.6, but these were sent at 12 and 15.
    const s = transferStats(
      ledger([remit(100, { to: 'X', rate: 12 }), remit(100, { to: 'X', rate: 15 })]),
      SINCE,
      FALLBACK,
    );
    expect(s[0]?.delivered).toBe(100 * 12 + 100 * 15);
  });

  it('falls back to the current rate only for transfers that predate rate recording', () => {
    const s = transferStats(ledger([remit(100, { to: 'X' })]), SINCE, FALLBACK);
    expect(s[0]?.delivered).toBe(1360);
  });

  it('groups unnamed transfers under a placeholder rather than dropping them', () => {
    const s = transferStats(ledger([remit(100)]), SINCE, FALLBACK);
    expect(s[0]?.to).toBe('—');
    expect(s[0]?.sent).toBe(100);
  });

  it('excludes transfers before the window', () => {
    const old = remit(999, { to: 'X', ts: new Date(2026, 0, 1).getTime() });
    expect(transferStats(ledger([old]), SINCE, FALLBACK)).toHaveLength(0);
  });
});

describe('transferSummary', () => {
  const rows = [
    remit(515, { to: 'X', fee: 15, rate: 13.0 }),
    remit(310, { to: 'X', fee: 10, rate: 14.0 }),
    remit(205, { to: 'Y', fee: 5, rate: 13.5 }),
  ];
  const sum = transferSummary(ledger(rows), SINCE, FALLBACK);

  it('totals what was sent and what it cost', () => {
    expect(sum.count).toBe(3);
    expect(sum.sent).toBe(500 + 300 + 200);
    expect(sum.fees).toBe(30);
    expect(sum.feeRate).toBeCloseTo(30 / 1000, 6);
  });

  it('reports the best and worst rates actually achieved', () => {
    expect(sum.bestRate).toBe(14);
    expect(sum.worstRate).toBe(13);
  });

  it('prices the cost of poor timing against the best rate achieved', () => {
    // Everything at 14 would have delivered 14,000; actual was less.
    expect(sum.lostToTiming).toBeCloseTo(1000 * 14 - sum.delivered, 6);
    expect(sum.lostToTiming).toBeGreaterThan(0);
  });

  it('reports no timing loss when every transfer used the same rate', () => {
    const flat = transferSummary(
      ledger([remit(100, { rate: 13 }), remit(100, { rate: 13 })]),
      SINCE,
      FALLBACK,
    );
    expect(flat.lostToTiming).toBe(0);
  });

  it('handles an empty window without dividing by zero', () => {
    const none = transferSummary(ledger([]), SINCE, FALLBACK);
    expect(none.count).toBe(0);
    expect(none.feeRate).toBe(0);
    expect(none.averageSent).toBe(0);
    expect(none.bestRate).toBeNull();
  });
});

describe('annualFeeCost', () => {
  it('projects a small-looking fee into a yearly figure', () => {
    const sum = transferSummary(ledger([remit(515, { fee: 15 }), remit(310, { fee: 10 })]), SINCE, FALLBACK);
    // 25 in 30 days ≈ 304 a year, which reads very differently from "15".
    expect(annualFeeCost(sum, 30)).toBeCloseTo((25 / 30) * 365, 4);
  });

  it('is zero for a zero-length window rather than infinite', () => {
    const sum = transferSummary(ledger([remit(100, { fee: 10 })]), SINCE, FALLBACK);
    expect(annualFeeCost(sum, 0)).toBe(0);
  });
});
