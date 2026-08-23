import { describe, expect, it } from 'vitest';
import { amortizedInstBal, cardClaim, cardPosition, monthsElapsed } from './card';
import { emptyLedger } from './defaults';
import type { CardSetup, Ledger, Tx } from './types';

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

describe('the installment balance pays itself down', () => {
  const SETUP = new Date(2026, 1, 10).getTime();

  function planned(over: Partial<CardSetup> = {}) {
    return {
      ...emptyLedger(),
      cardCfg: { limit: 20000, closeDay: 1, dueDay: 25 },
      cardSetup: { stmt0: 0, unbilled0: 0, instBal: 4800, instMo: 400, setupAt: SETUP, ...over },
    };
  }

  it('counts only whole months that have come round', () => {
    expect(monthsElapsed(SETUP, new Date(2026, 1, 10))).toBe(0);
    expect(monthsElapsed(SETUP, new Date(2026, 2, 9))).toBe(0);
    expect(monthsElapsed(SETUP, new Date(2026, 2, 10))).toBe(1);
    expect(monthsElapsed(SETUP, new Date(2027, 1, 10))).toBe(12);
  });

  it('takes one charge off for each month elapsed', () => {
    expect(cardPosition(planned(), new Date(2026, 1, 10)).instBal).toBe(4800);
    expect(cardPosition(planned(), new Date(2026, 4, 10)).instBal).toBe(3600);
    expect(cardPosition(planned(), new Date(2026, 7, 14)).instBal).toBe(2400);
  });

  it('stops at zero rather than going negative once the plan finishes', () => {
    expect(cardPosition(planned(), new Date(2028, 0, 10)).instBal).toBe(0);
  });

  it('leaves an older setup with no date exactly as it was', () => {
    // Amortising from an unknown start would invent a payment history.
    const legacy = planned({ setupAt: null });
    expect(cardPosition(legacy, new Date(2027, 5, 1)).instBal).toBe(4800);
  });

  it('does not amortise a plan with no declared monthly charge', () => {
    const unknown = planned({ instMo: 0 });
    expect(cardPosition(unknown, new Date(2027, 5, 1)).instBal).toBe(4800);
  });

  it('shrinks what the claim defers as the plan is paid down', () => {
    const early = cardClaim(planned(), new Date(2026, 1, 1).getTime(), new Date(2026, 1, 10));
    const later = cardClaim(planned(), new Date(2026, 7, 1).getTime(), new Date(2026, 7, 14));
    expect(early.deferred).toBe(4400);
    expect(later.deferred).toBe(2000);
    // The monthly charge itself keeps being claimed either way.
    expect(later.installment).toBe(400);
  });
});
