import { describe, expect, it } from 'vitest';
import real from './__fixtures__/backup-2026-08-14.json';
import { emptyLedger } from './defaults';
import { importBackup } from './importBackup';
import { debtSummary, personHistory, repaidRatio } from './people';
import type { Ledger, Person, Tx } from './types';

function person(over: Partial<Person> = {}): Person {
  return { id: 'p1', name: 'حسان', amt: 1000, out: 1000, dir: 'owed', ...over };
}
function ledger(tx: Tx[] = [], people: Person[] = []): Ledger {
  return { ...emptyLedger(), tx, people };
}

describe('personHistory', () => {
  it('walks the balance down as repayments arrive', () => {
    const p = person();
    const h = personHistory(
      ledger([
        { id: 'a', ts: 2, type: 'income', acct: 'bank', amt: 400, personId: 'p1' },
        { id: 'b', ts: 3, type: 'income', acct: 'bank', amt: 300, personId: 'p1' },
      ]),
      p,
    );
    expect(h.map((e) => e.runningOut)).toEqual([600, 300]);
    expect(h.every((e) => e.direction === 'decrease')).toBe(true);
  });

  it('orders oldest first, whatever order the ledger holds', () => {
    const h = personHistory(
      ledger([
        { id: 'b', ts: 9, type: 'income', acct: 'bank', amt: 100, personId: 'p1' },
        { id: 'a', ts: 1, type: 'income', acct: 'bank', amt: 100, personId: 'p1' },
      ]),
      person(),
    );
    expect(h.map((e) => e.tx.id)).toEqual(['a', 'b']);
  });

  it('never walks the balance below zero on an overpayment', () => {
    const h = personHistory(
      ledger([{ id: 'a', ts: 1, type: 'income', acct: 'bank', amt: 5000, personId: 'p1' }]),
      person(),
    );
    expect(h[0]?.runningOut).toBe(0);
  });

  it('ignores entries belonging to someone else', () => {
    const h = personHistory(
      ledger([{ id: 'a', ts: 1, type: 'income', acct: 'bank', amt: 100, personId: 'other' }]),
      person(),
    );
    expect(h).toHaveLength(0);
  });

  it('treats a repayment to someone owed as a decrease too', () => {
    const h = personHistory(
      ledger([{ id: 'a', ts: 1, type: 'debtpay', acct: 'bank', amt: 200, personId: 'p1' }]),
      person({ dir: 'owe', amt: 500, out: 500 }),
    );
    expect(h[0]?.direction).toBe('decrease');
    expect(h[0]?.runningOut).toBe(300);
  });
});

describe('debtSummary', () => {
  it('separates what is owed each way and nets them', () => {
    const s = debtSummary(
      ledger([], [
        person({ id: 'a', dir: 'owed', out: 300 }),
        person({ id: 'b', dir: 'owed', out: 300 }),
        person({ id: 'c', dir: 'owe', out: 500 }),
      ]),
    );
    expect(s.owedToMe).toBe(600);
    expect(s.owed).toBe(500);
    expect(s.net).toBe(100);
    expect(s.activeCount).toBe(3);
  });

  it('names the largest outstanding debt', () => {
    const s = debtSummary(
      ledger([], [person({ id: 'a', name: 'A', out: 100 }), person({ id: 'b', name: 'B', out: 900 })]),
    );
    expect(s.largest?.name).toBe('B');
    expect(s.largest?.amount).toBe(900);
  });

  it('counts settled people separately from active ones', () => {
    const s = debtSummary(ledger([], [person({ id: 'a', out: 0 }), person({ id: 'b', out: 50 })]));
    expect(s.settledCount).toBe(1);
    expect(s.activeCount).toBe(1);
  });

  it('reports nothing for an empty list rather than throwing', () => {
    const s = debtSummary(ledger());
    expect(s.net).toBe(0);
    expect(s.largest).toBeNull();
  });

  it('matches the real backup', () => {
    const { ledger: real14 } = importBackup(real);
    const s = debtSummary(real14);
    // حسان 300 + اسامة 300 outstanding; the 1000 came back already.
    expect(s.owedToMe).toBe(600);
    expect(s.owed).toBe(0);
    expect(s.settledCount).toBe(1);
  });
});

describe('repaidRatio', () => {
  it('reports how much has come back', () => {
    expect(repaidRatio(person({ amt: 1000, out: 250 }))).toBe(0.75);
  });

  it('is one when fully settled', () => {
    expect(repaidRatio(person({ amt: 1000, out: 0 }))).toBe(1);
  });

  it('is zero for a principal of zero rather than dividing by it', () => {
    expect(repaidRatio(person({ amt: 0, out: 0 }))).toBe(0);
  });
});
