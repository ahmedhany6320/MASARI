import { describe, expect, it } from 'vitest';
import { cardClaim, cardPosition, instBilled, monthsElapsed } from './card';
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

  it('sends what clears the statement to the installments next', () => {
    // 5,000 clears the statement exactly; the extra 600 goes to the plan,
    // which is the next thing the bill actually asks for.
    const cc = cardPosition(ledger({ tx: [pay(5600)] }));
    expect(cc.stmtRem).toBe(0);
    expect(cc.instBal).toBe(2400);
    expect(cc.unbilled).toBe(1000);
  });

  it('reaches unbilled once the statement and the plan are both settled', () => {
    // 5,000 statement + 3,000 plan = 8,000; the last 600 eats into unbilled.
    const cc = cardPosition(ledger({ tx: [pay(8600)] }));
    expect(cc.stmtRem).toBe(0);
    expect(cc.instBal).toBe(0);
    expect(cc.unbilled).toBe(400);
    expect(cc.out).toBe(400);
  });

  it('spills straight onto unbilled when there is no plan in the way', () => {
    const noPlan = ledger({
      cardSetup: { stmt0: 5000, unbilled0: 1000, instBal: 0, instMo: 0 },
      tx: [pay(5600)],
    });
    expect(cardPosition(noPlan).unbilled).toBe(400);
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

describe('the installment plan comes down when it is PAID', () => {
  const SETUP = new Date(2026, 1, 10).getTime();
  const AUG = new Date(2026, 7, 14);

  function planned(over: Partial<CardSetup> = {}, txs: Tx[] = []) {
    return {
      ...emptyLedger(),
      cardCfg: { limit: 20000, closeDay: 1, dueDay: 25 },
      cardSetup: { stmt0: 1000, unbilled0: 0, instBal: 4800, instMo: 400, setupAt: SETUP, ...over },
      tx: txs,
    };
  }
  function pay(amt: number): Tx {
    return { id: `p${amt}`, ts: new Date(2026, 7, 12).getTime(), type: 'ccpay', acct: 'bank', amt };
  }

  it('counts only whole months that have come round', () => {
    expect(monthsElapsed(SETUP, new Date(2026, 1, 10))).toBe(0);
    expect(monthsElapsed(SETUP, new Date(2026, 2, 9))).toBe(0);
    expect(monthsElapsed(SETUP, new Date(2026, 2, 10))).toBe(1);
    expect(monthsElapsed(SETUP, new Date(2027, 1, 10))).toBe(12);
  });

  it('does not move for someone who has paid nothing', () => {
    // Time alone must never retire an installment: the balance is what is
    // still owed, and nothing has been settled.
    expect(cardPosition(planned(), AUG).instBal).toBe(4800);
  });

  it('retires the installment once the statement is cleared and more is paid', () => {
    // 1,000 clears the statement; the next 400 settles one installment.
    expect(cardPosition(planned({}, [pay(1400)]), AUG).instBal).toBe(4400);
  });

  it('retires several when several are paid at once', () => {
    expect(cardPosition(planned({}, [pay(1000 + 1200)]), AUG).instBal).toBe(3600);
  });

  it('leaves the plan alone while the payment is still covering the statement', () => {
    const p = cardPosition(planned({}, [pay(600)]), AUG);
    expect(p.stmtRem).toBe(400);
    expect(p.instBal).toBe(4800);
  });

  it('never retires more than has been billed to date', () => {
    // Six months in, only 7 charges have been billed however much is paid.
    const p = cardPosition(planned({}, [pay(1000 + 4800)]), AUG);
    expect(instBilled({ stmt0: 1000, unbilled0: 0, instBal: 4800, instMo: 400, setupAt: SETUP }, AUG)).toBe(2800);
    expect(p.instBal).toBe(2000);
  });

  it('sends anything past the billed installments to unbilled spending', () => {
    // 1,000 statement + 2,800 billed installments = 3,800; the last 500 lands
    // on the running balance rather than vanishing.
    const p = cardPosition(planned({ unbilled0: 900 }, [pay(4300)]), AUG);
    expect(p.instBal).toBe(2000);
    expect(p.unbilled).toBe(400);
  });

  it('stops at zero rather than going negative', () => {
    const p = cardPosition(planned({ setupAt: null }, [pay(1000 + 9000)]), AUG);
    expect(p.instBal).toBe(0);
  });

  it('lets a setup with no date be paid off without waiting for months', () => {
    // No start date means no schedule to measure, so payment alone decides.
    const p = cardPosition(planned({ setupAt: null }, [pay(1000 + 800)]), AUG);
    expect(p.instBal).toBe(4000);
  });

  it('does nothing for a plan with no declared monthly charge', () => {
    const p = cardPosition(planned({ instMo: 0 }, [pay(5000)]), AUG);
    expect(p.instBal).toBe(4800);
  });

  it('states both bills: the one standing now and the one coming', () => {
    const k = cardClaim(planned(), new Date(2026, 7, 1).getTime(), AUG);
    expect(k.billNow).toBe(1000 + 400);
    expect(k.billNext).toBe(k.cycleUnbilled + k.carried + 400);
  });

  it('shrinks what the claim defers as the plan is actually paid down', () => {
    const unpaid = cardClaim(planned(), new Date(2026, 7, 1).getTime(), AUG);
    const paid = cardClaim(planned({}, [pay(1000 + 1200)]), new Date(2026, 7, 1).getTime(), AUG);
    expect(unpaid.deferred).toBe(4400);
    expect(paid.deferred).toBe(3200);
    expect(paid.installment).toBe(400);
  });
});
