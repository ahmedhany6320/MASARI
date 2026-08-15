import { describe, expect, it } from 'vitest';
import { cardPosition } from './card';
import { emptyLedger } from './defaults';
import type { Ledger, Tx } from './types';

let seq = 0;
function cardSpend(amt: number, post = true): Tx {
  return { id: `c${seq++}`, ts: Date.parse('2026-08-10T12:00:00Z'), type: 'expense', acct: 'card', amt, post };
}
function pay(amt: number): Tx {
  return { id: `p${seq++}`, ts: Date.parse('2026-08-10T12:00:00Z'), type: 'ccpay', acct: 'bank', amt };
}

function ledger(over: Partial<Ledger> = {}): Ledger {
  return {
    ...emptyLedger(),
    cardCfg: { limit: 20000, closeDay: 1, dueDay: 25 },
    cardSetup: { stmt0: 5000, unbilled0: 1000, instBal: 3000, instMo: 500 },
    ...over,
  };
}

describe('cardPosition', () => {
  it('reports the opening position when nothing has happened', () => {
    const cc = cardPosition(ledger());
    expect(cc.stmtRem).toBe(5000);
    expect(cc.unbilled).toBe(1000);
    expect(cc.out).toBe(6000);
    expect(cc.utilized).toBe(9000); // 5000 + 1000 + 3000 installments
    expect(cc.avail).toBe(11000);
  });

  it('adds card spending to unbilled, not to the statement', () => {
    const cc = cardPosition(ledger({ tx: [cardSpend(400)] }));
    expect(cc.stmtRem).toBe(5000);
    expect(cc.unbilled).toBe(1400);
    expect(cc.purch).toBe(400);
    expect(cc.txCount).toBe(1);
  });

  it('applies payments to the statement first', () => {
    const cc = cardPosition(ledger({ tx: [pay(2000)] }));
    expect(cc.stmtRem).toBe(3000);
    expect(cc.unbilled).toBe(1000); // untouched — statement not yet cleared
    expect(cc.paidThisStmt).toBe(2000);
  });

  it('spills only the leftover onto unbilled once the statement is cleared', () => {
    // 5000 clears the statement exactly; the extra 600 eats into unbilled.
    const cc = cardPosition(ledger({ tx: [pay(5600)] }));
    expect(cc.stmtRem).toBe(0);
    expect(cc.unbilled).toBe(400);
    expect(cc.out).toBe(400);
  });

  it('never reports a negative liability on overpayment', () => {
    const cc = cardPosition(ledger({ tx: [pay(99999)] }));
    expect(cc.stmtRem).toBe(0);
    expect(cc.unbilled).toBe(0);
    expect(cc.out).toBe(0);
  });

  it('honours a manual unbilled adjustment', () => {
    const cc = cardPosition(ledger({ cardAdj: 250 }));
    expect(cc.unbilled).toBe(1250);
  });

  it('excludes non-posting card spending', () => {
    const cc = cardPosition(ledger({ tx: [cardSpend(400, false)] }));
    expect(cc.unbilled).toBe(1000);
    expect(cc.purch).toBe(0);
    expect(cc.txCount).toBe(0);
  });

  it('treats an unconfigured card as all zeroes rather than throwing', () => {
    const cc = cardPosition({ ...emptyLedger(), cardCfg: { limit: 0, closeDay: 1, dueDay: 25 } });
    expect(cc.out).toBe(0);
    expect(cc.utilized).toBe(0);
    expect(cc.avail).toBe(0);
  });

  it('shows headroom shrinking as spending accumulates', () => {
    const cc = cardPosition(ledger({ tx: [cardSpend(1000), cardSpend(2000)] }));
    expect(cc.utilized).toBe(12000); // 5000 + (1000+3000) + 3000
    expect(cc.avail).toBe(8000);
  });
});
