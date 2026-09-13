import { describe, expect, it } from 'vitest';
import {
  recordSettlement,
  settlementAverage,
  settlementFor,
  settlementHistory,
} from './commitments';
import type { Commitment } from './types';

function rent(patch: Partial<Commitment> = {}): Commitment {
  return {
    id: 'rent',
    ar: 'إيجار',
    en: 'Rent',
    amt: 1_800,
    day: 1,
    paused: false,
    paidMonth: false,
    ...patch,
  };
}

describe('a commitment keeps every month it was settled', () => {
  it('appends rather than overwriting', () => {
    // The bug: settling October wrote over September, so the month a bill
    // came in under plan — and the money that sent to the goal — stopped
    // being answerable the moment the next month was ticked.
    let c = rent();
    c = recordSettlement(c, { cycle: '2026-08', actual: 1_800, ts: 1 });
    c = recordSettlement(c, { cycle: '2026-09', actual: 1_775, ts: 2 });
    c = recordSettlement(c, { cycle: '2026-10', actual: 1_850, ts: 3 });

    expect(settlementHistory(c).map((h) => h.cycle)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(settlementFor(c, '2026-09')?.actual).toBe(1_775);
  });

  it('keeps the single-cycle fields pointing at the latest month', () => {
    let c = rent();
    c = recordSettlement(c, { cycle: '2026-09', actual: 1_775, ts: 2 });
    c = recordSettlement(c, { cycle: '2026-10', actual: 1_850, ts: 3 });
    expect(c.paidFor).toBe('2026-10');
    expect(c.actual).toBe(1_850);
    expect(c.paidMonth).toBe(true);
  });

  it('corrects a month rather than recording it twice', () => {
    // Two settlements for one cycle would hand the goal the same variance
    // twice over.
    let c = rent();
    c = recordSettlement(c, { cycle: '2026-09', actual: 1_775, ts: 2 });
    c = recordSettlement(c, { cycle: '2026-09', actual: 1_790, ts: 4 });
    expect(settlementHistory(c)).toHaveLength(1);
    expect(settlementFor(c, '2026-09')?.actual).toBe(1_790);
  });

  it('orders by cycle even when months are recorded out of order', () => {
    let c = rent();
    c = recordSettlement(c, { cycle: '2026-10', actual: 1_850, ts: 3 });
    c = recordSettlement(c, { cycle: '2026-08', actual: 1_800, ts: 1 });
    expect(settlementHistory(c).map((h) => h.cycle)).toEqual(['2026-08', '2026-10']);
    expect(c.paidFor).toBe('2026-10');
  });

  it('does not mutate what it was given', () => {
    const before = rent();
    const frozen = JSON.stringify(before);
    recordSettlement(before, { cycle: '2026-09', actual: 1_775, ts: 2 });
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('links the settlement to the transaction that recorded it', () => {
    const c = recordSettlement(rent(), { cycle: '2026-09', actual: 1_775, ts: 2, txId: 'tx-9' });
    expect(settlementFor(c, '2026-09')?.txId).toBe('tx-9');
  });
});

describe('a ledger saved before the series existed', () => {
  it('still reports the one month it knows about', () => {
    const legacy = rent({ paidFor: '2026-09', actual: 1_775, paidMonth: true });
    expect(settlementHistory(legacy)).toEqual([{ cycle: '2026-09', actual: 1_775, ts: 0 }]);
    expect(settlementFor(legacy, '2026-09')?.actual).toBe(1_775);
  });

  it('reports nothing for a commitment never settled', () => {
    expect(settlementHistory(rent())).toEqual([]);
    expect(settlementFor(rent(), '2026-09')).toBeNull();
    expect(settlementAverage(rent())).toBeNull();
  });

  it('grows a proper series from the single month it started with', () => {
    const legacy = rent({ paidFor: '2026-09', actual: 1_775, paidMonth: true });
    const c = recordSettlement(legacy, { cycle: '2026-10', actual: 1_850, ts: 3 });
    expect(settlementHistory(c).map((h) => h.actual)).toEqual([1_775, 1_850]);
  });
});

describe('spotting a bill that is drifting', () => {
  it('averages the most recent months', () => {
    let c = rent();
    for (const [cycle, actual] of [
      ['2026-06', 1_700],
      ['2026-07', 1_800],
      ['2026-08', 1_850],
      ['2026-09', 1_950],
    ] as const) {
      c = recordSettlement(c, { cycle, actual, ts: 0 });
    }
    // The last three, not all four: a bill that has crept up is not described
    // by the months before it crept.
    expect(settlementAverage(c, 3)).toBeCloseTo((1_800 + 1_850 + 1_950) / 3, 2);
  });

  it('averages what there is when there are fewer months than asked for', () => {
    const c = recordSettlement(rent(), { cycle: '2026-09', actual: 1_775, ts: 0 });
    expect(settlementAverage(c, 6)).toBe(1_775);
  });
});
