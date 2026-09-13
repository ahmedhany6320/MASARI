import { describe, expect, it } from 'vitest';
import { cardClaim } from './card';
import { emptyLedger } from './defaults';
import type { Ledger, Tx } from './types';

const CYCLE_FROM = new Date(2026, 7, 1).getTime();
const LAST_CYCLE = new Date(2026, 6, 20).getTime();
const THIS_CYCLE = new Date(2026, 7, 5).getTime();

let seq = 0;
function cardSpend(amt: number, ts: number): Tx {
  return { id: `c${seq++}`, ts, type: 'expense', acct: 'card', amt };
}
function led(over: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(), cardCfg: { limit: 20000, closeDay: 1, dueDay: 25 }, ...over };
}

describe('cardClaim — every dirham lands in exactly one bucket', () => {
  it('splits the revolving balance by when it was spent', () => {
    const s = led({
      cardSetup: { stmt0: 1000, unbilled0: 200, instBal: 0, instMo: 0 },
      tx: [cardSpend(300, THIS_CYCLE), cardSpend(150, LAST_CYCLE)],
    });
    const k = cardClaim(s, CYCLE_FROM);

    expect(k.statement).toBe(1000);
    // 200 opening + 150 spent last cycle, neither in this cycle's expenses.
    expect(k.carried).toBe(350);
    expect(k.cycleUnbilled).toBe(300);
    expect(k.due).toBe(1350);
  });

  it('accounts for the whole balance exactly once', () => {
    const s = led({
      cardSetup: { stmt0: 1000, unbilled0: 200, instBal: 2400, instMo: 400 },
      tx: [cardSpend(300, THIS_CYCLE), cardSpend(150, LAST_CYCLE)],
    });
    const k = cardClaim(s, CYCLE_FROM);

    // The identity that makes this auditable: nothing is lost, nothing doubles.
    expect(k.chargedThisMonth + k.deferred).toBeCloseTo(k.totalOwed, 10);
    expect(k.chargedThisMonth).toBe(k.due + k.cycleUnbilled);
  });

  it('charges the whole revolving balance this month, deferring only the plan', () => {
    const s = led({ cardSetup: { stmt0: 800, unbilled0: 500, instBal: 3000, instMo: 500 } });
    const k = cardClaim(s, CYCLE_FROM);

    expect(k.totalOwed).toBe(800 + 500 + 3000);
    // Statement + carried unbilled + this month's installment.
    expect(k.due).toBe(800 + 500 + 500);
    expect(k.deferred).toBe(2500);
  });

  it('flags an installment balance with no declared monthly charge', () => {
    const s = led({ cardSetup: { stmt0: 0, unbilled0: 0, instBal: 2653, instMo: 0 } });
    const k = cardClaim(s, CYCLE_FROM);

    expect(k.installmentUnknown).toBe(true);
    // The whole plan defers with no schedule behind it — hence the flag.
    expect(k.deferred).toBe(2653);
    expect(k.due).toBe(0);
  });

  it('does not flag a plan that declares its monthly charge', () => {
    const s = led({ cardSetup: { stmt0: 0, unbilled0: 0, instBal: 2653, instMo: 400 } });
    expect(cardClaim(s, CYCLE_FROM).installmentUnknown).toBe(false);
  });

  it('claims nothing when the card is untouched', () => {
    const k = cardClaim(led(), CYCLE_FROM);
    expect(k.due).toBe(0);
    expect(k.totalOwed).toBe(0);
    expect(k.installmentUnknown).toBe(false);
  });

  it('lets a payment clear the statement before it touches unbilled', () => {
    const s = led({
      cardSetup: { stmt0: 1000, unbilled0: 400, instBal: 0, instMo: 0 },
      tx: [{ id: 'p1', ts: THIS_CYCLE, type: 'ccpay', acct: 'bank', amt: 1200 }],
    });
    const k = cardClaim(s, CYCLE_FROM);

    expect(k.statement).toBe(0);
    // 200 of leftover ate into the 400 opening unbilled.
    expect(k.carried).toBe(200);
    expect(k.due).toBe(200);
  });
});
