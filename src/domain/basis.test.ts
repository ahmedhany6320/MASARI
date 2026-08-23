import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { safeSpend } from './safeSpend';
import type { Commitment, Ledger, Tx } from './types';

const FX = 13.6;
// 14 Aug 2026 noon → 18 days to payday.
const NOW = new Date(2026, 7, 14, 12, 0, 0);
const EARLIER = new Date(2026, 7, 3).getTime();

let seq = 0;
function spend(amt: number, ts: number, acct: 'bank' | 'card' | 'cash' = 'bank'): Tx {
  return { id: `x${seq++}`, ts, type: 'expense', acct, amt };
}
function commit(amt: number, day: number, over: Partial<Commitment> = {}): Commitment {
  return { id: `k${seq++}`, ar: '', en: '', amt, day, paused: false, paidMonth: false, ...over };
}
function led(over: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(), base: 11000, bankOpen: 6000, ...over };
}

describe('the balance basis — "this is all the money I have"', () => {
  it('sizes the limit from money held, not from the salary', () => {
    // Salary is 11,000 but only 6,000 is left: starting mid-cycle, the balance
    // is the fact and the salary is only there to date the next payday.
    const s = led({ sslBasis: 'balance' });
    const c = safeSpend(s, FX, NOW);
    expect(c.basis).toBe('balance');
    expect(c.livingPool).toBe(6000);
    expect(c.ssl).toBeCloseTo(6000 / 18, 10);
  });

  it('does not subtract spending history, which the balance already reflects', () => {
    // On the salary basis this 2,000 would come off the pool. Here it is
    // already missing from the 6,000, and subtracting it again would charge it
    // twice — the exact trap of mixing the two bases.
    const s = led({ sslBasis: 'balance', tx: [spend(2000, EARLIER, 'bank')] });
    const c = safeSpend(s, FX, NOW);
    expect(c.spendable).toBe(4000);
  });

  it('still subtracts this cycle card spending, which the balance cannot see', () => {
    // Card spending has not left the bank yet, so the balance is unchanged by
    // it — but the money is spent all the same.
    const s = led({ sslBasis: 'balance', tx: [spend(800, EARLIER, 'card')] });
    const c = safeSpend(s, FX, NOW);
    expect(c.cardCycleUnbilled).toBe(800);
    expect(c.spendable).toBe(6000 - 800);
  });

  it('still honours every claim on the money', () => {
    const s = led({
      sslBasis: 'balance',
      commits: [commit(1000, 25)],
      planTf: [{ id: 'p1', amt: 500, day: 20 }],
    });
    const c = safeSpend(s, FX, NOW);
    expect(c.livingPool).toBe(6000 - 1000 - 500);
  });

  it('counts cash alongside the bank', () => {
    const s = led({ sslBasis: 'balance', cashOpen: 1500 });
    expect(safeSpend(s, FX, NOW).livingPool).toBe(7500);
  });

  it('leaves the salary basis exactly as it was when unset', () => {
    const c = safeSpend(led(), FX, NOW);
    expect(c.basis).toBe('salary');
    expect(c.livingPool).toBe(11000);
  });
});

describe('commitments are scheduled, not just summed', () => {
  it('deducts one still to fall due this cycle', () => {
    const c = safeSpend(led({ commits: [commit(2000, 25)] }), FX, NOW);
    expect(c.commitObl).toBe(2000);
    expect(c.commitments.upcoming).toBe(2000);
  });

  it('still deducts an overdue one, but asks about it', () => {
    const c = safeSpend(led({ commits: [commit(2000, 3)] }), FX, NOW);
    expect(c.commitObl).toBe(2000);
    expect(c.commitments.overdue).toBe(2000);
    expect(c.commitments.needsConfirm).toBe(1);
  });

  it('stops deducting one paid for this cycle', () => {
    const c = safeSpend(led({ commits: [commit(2000, 3, { paidFor: '2026-08' })] }), FX, NOW);
    expect(c.commitObl).toBe(0);
  });

  it('deducts it again next cycle, which the old boolean never did', () => {
    // The bug this replaces: a bill ticked in August stayed ticked forever.
    const s = led({ commits: [commit(2000, 3, { paidFor: '2026-08' })] });
    expect(safeSpend(s, FX, new Date(2026, 8, 14, 12)).commitObl).toBe(2000);
  });

  it('deducts nothing for one with no amount set', () => {
    const c = safeSpend(led({ commits: [commit(0, 10)] }), FX, NOW);
    expect(c.commitObl).toBe(0);
    expect(c.commitments.incomplete).toBe(1);
  });
});
