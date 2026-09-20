import { describe, expect, it } from 'vitest';
import { bankBalance, cashBalance } from './balances';
import { emptyLedger } from './defaults';
import type { Tx, TxType, Account } from './types';

let seq = 0;
function tx(type: TxType, amt: number, acct?: Account, extra: Partial<Tx> = {}): Tx {
  return { id: `t${seq++}`, ts: Date.parse('2026-08-10T12:00:00Z'), type, amt, acct, ...extra };
}

describe('bankBalance', () => {
  it('starts from the opening reconciled balance', () => {
    const s = { ...emptyLedger(), bankOpen: 23800 };
    expect(bankBalance(s)).toBe(23800);
  });

  it('applies income and expenses on the bank account', () => {
    const s = { ...emptyLedger(), bankOpen: 1000, tx: [tx('income', 500, 'bank'), tx('expense', 200, 'bank')] };
    expect(bankBalance(s)).toBe(1300);
  });

  it('ignores income and expenses on other accounts', () => {
    const s = { ...emptyLedger(), bankOpen: 1000, tx: [tx('expense', 200, 'card'), tx('expense', 50, 'cash')] };
    expect(bankBalance(s)).toBe(1000);
  });

  it('skips entries already baked into the opening balance', () => {
    const s = {
      ...emptyLedger(),
      bankOpen: 23800,
      tx: [tx('income', 11000, 'bank', { post: false })],
    };
    expect(bankBalance(s)).toBe(23800);
  });

  it('treats remittances and withdrawals as bank outflows regardless of acct', () => {
    const s = { ...emptyLedger(), bankOpen: 5000, tx: [tx('remit', 1000), tx('wd', 500)] };
    expect(bankBalance(s)).toBe(3500);
  });

  it('treats deposits as bank inflows', () => {
    const s = { ...emptyLedger(), bankOpen: 5000, tx: [tx('dep', 300)] };
    expect(bankBalance(s)).toBe(5300);
  });

  it('applies signed reconciliation adjustments in both directions', () => {
    const up = { ...emptyLedger(), bankOpen: 1000, tx: [tx('adjust', 250)] };
    const down = { ...emptyLedger(), bankOpen: 1000, tx: [tx('adjust', -250)] };
    expect(bankBalance(up)).toBe(1250);
    expect(bankBalance(down)).toBe(750);
  });

  it('lowers the bank when lending and raises it when borrowing', () => {
    const s = { ...emptyLedger(), bankOpen: 1000, tx: [tx('lend', 300, 'bank'), tx('borrow', 100, 'bank')] };
    expect(bankBalance(s)).toBe(800);
  });

  it('lowers the bank on card and debt payments', () => {
    const s = { ...emptyLedger(), bankOpen: 5000, tx: [tx('ccpay', 2000, 'bank'), tx('debtpay', 500, 'bank')] };
    expect(bankBalance(s)).toBe(2500);
  });
});

describe('cashBalance', () => {
  it('is null until the user opts into tracking cash', () => {
    expect(cashBalance({ ...emptyLedger(), cashOpen: null })).toBeNull();
  });

  it('distinguishes "not tracking" from "tracking, holding zero"', () => {
    expect(cashBalance({ ...emptyLedger(), cashOpen: 0 })).toBe(0);
  });

  it('mirrors withdrawals and deposits against the bank', () => {
    const s = { ...emptyLedger(), cashOpen: 100, tx: [tx('wd', 500), tx('dep', 200)] };
    expect(cashBalance(s)).toBe(400);
  });

  it('a withdrawal moves money without changing net worth', () => {
    const s = { ...emptyLedger(), bankOpen: 1000, cashOpen: 0, tx: [tx('wd', 400)] };
    expect(bankBalance(s)).toBe(600);
    expect(cashBalance(s)).toBe(400);
    expect(bankBalance(s) + (cashBalance(s) ?? 0)).toBe(1000);
  });

  it('applies cash expenses', () => {
    const s = { ...emptyLedger(), cashOpen: 500, tx: [tx('expense', 120, 'cash')] };
    expect(cashBalance(s)).toBe(380);
  });
});
