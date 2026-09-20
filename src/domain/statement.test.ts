import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { statementCycle } from './statement';
import type { Ledger } from './types';

let n = 0;
const id = () => `s-${++n}`;

function card(closeDay: number, dueDay: number, tx: Ledger['tx'] = []): Ledger {
  return {
    ...emptyLedger(id),
    cardCfg: { limit: 20_000, closeDay, dueDay },
    cardSetup: { stmt0: 0, unbilled0: 0, instBal: 0, instMo: 0, setupAt: new Date(2026, 0, 1).getTime() },
    tx,
  };
}

const spend = (day: number, amt: number, month = 8): Ledger['tx'][number] => ({
  id: `x${month}-${day}-${amt}`,
  ts: new Date(2026, month, day, 12, 0).getTime(),
  type: 'expense',
  acct: 'card',
  amt,
});

describe('the statement period', () => {
  it('closes at the end of the closing day, so that day is still on it', () => {
    // Closing on the 3rd, asked about on the 3rd: the statement that closed is
    // the PREVIOUS month's, because today's has not finished yet.
    const st = statementCycle(card(3, 25), new Date(2026, 8, 3, 12, 0));
    expect(st.closedAt).toEqual(new Date(2026, 7, 4));
    expect(st.closesNext).toEqual(new Date(2026, 8, 3));
  });

  it('rolls to this month once the closing day has passed', () => {
    const st = statementCycle(card(3, 25), new Date(2026, 8, 4, 12, 0));
    expect(st.closedAt).toEqual(new Date(2026, 8, 4));
    expect(st.closesNext).toEqual(new Date(2026, 9, 3));
  });

  it('covers the month before the close', () => {
    const st = statementCycle(card(3, 25), new Date(2026, 8, 10, 12, 0));
    expect(st.openedAt).toEqual(new Date(2026, 7, 4));
    expect(st.closedAt).toEqual(new Date(2026, 8, 4));
  });

  it('rolls out of February without losing a period', () => {
    // On the 28th the statement closing on the 28th has not closed yet, so the
    // next close is still February's.
    const on = statementCycle(card(28, 15), new Date(2026, 1, 28, 12, 0));
    expect(on.closesNext).toEqual(new Date(2026, 1, 28));

    // The day after, it has closed and the next one is March's.
    const after = statementCycle(card(28, 15), new Date(2026, 2, 1, 12, 0));
    expect(after.closedAt).toEqual(new Date(2026, 1, 29));
    expect(after.closesNext).toEqual(new Date(2026, 2, 28));
  });
});

describe('the due date', () => {
  it('falls in the same month when the due day comes after the close', () => {
    const st = statementCycle(card(1, 25), new Date(2026, 8, 13, 12, 0));
    expect(st.dueAt).toEqual(new Date(2026, 8, 25));
    expect(st.daysToDue).toBe(12);
    expect(st.overdue).toBe(false);
  });

  it('falls in the next month when the due day comes before the close', () => {
    // A card closing on the 25th and due on the 10th is due on the 10th of the
    // NEXT month — not two weeks before the statement it pays for existed.
    const st = statementCycle(card(25, 10), new Date(2026, 8, 27, 12, 0));
    expect(st.closedAt).toEqual(new Date(2026, 8, 26));
    expect(st.dueAt).toEqual(new Date(2026, 9, 10));
  });

  it('is overdue only when the date has passed AND something is owed', () => {
    const owing = statementCycle(card(1, 10, [spend(2, 400, 7)]), new Date(2026, 8, 20, 12, 0));
    expect(owing.daysToDue).toBeLessThan(0);
    expect(owing.overdue).toBe(true);

    const clear = statementCycle(card(1, 10), new Date(2026, 8, 20, 12, 0));
    expect(clear.billed).toBe(0);
    expect(clear.overdue).toBe(false);
  });
});

describe('what the closed statement demands', () => {
  it('bills what was spent before the close and defers what came after', () => {
    const l = card(3, 25, [
      spend(1, 100), // before the 3rd — on the closed statement
      spend(3, 50), // ON the closing day — still on the closed statement
      spend(6, 70), // after the close — next statement
    ]);
    const st = statementCycle(l, new Date(2026, 8, 10, 12, 0));
    expect(st.billed).toBe(150);
    expect(st.sinceClose).toBe(70);
    expect(st.totalOwed).toBe(220);
  });

  it('adds the installment charge that bills alongside it', () => {
    const l = card(1, 25, [spend(3, 200)]);
    const st = statementCycle(
      { ...l, cardSetup: { ...l.cardSetup!, instBal: 2_400, instMo: 200 } },
      new Date(2026, 8, 10, 12, 0),
    );
    // Spending on the 3rd post-dates a close on the 1st, so only the
    // installment is demanded now.
    expect(st.sinceClose).toBe(200);
    expect(st.billed).toBe(200);
  });

  it('never reports the card owing the user money', () => {
    const l = card(1, 25, [
      spend(5, 100),
      { id: 'p', ts: new Date(2026, 8, 6, 12, 0).getTime(), type: 'ccpay', acct: 'bank', amt: 500 },
    ]);
    const st = statementCycle(l, new Date(2026, 8, 10, 12, 0));
    expect(st.billed).toBeGreaterThanOrEqual(0);
    expect(st.totalOwed).toBeGreaterThanOrEqual(0);
  });

  it('splits at the statement boundary, not the salary boundary', () => {
    // The whole point: with a close on the 5th, the 2nd belongs to the
    // statement that already closed even though the salary cycle calls it
    // this month's.
    const st = statementCycle(card(5, 25, [spend(2, 90)]), new Date(2026, 8, 12, 12, 0));
    expect(st.billed).toBe(90);
    expect(st.sinceClose).toBe(0);
  });

  it('everything owed is either billed, spent since, or deferred', () => {
    const l = card(3, 25, [spend(1, 100), spend(6, 70)]);
    const withPlan = { ...l, cardSetup: { ...l.cardSetup!, instBal: 1_200, instMo: 100 } };
    const st = statementCycle(withPlan, new Date(2026, 8, 10, 12, 0));
    const deferred = 1_200 - 100;
    expect(st.billed + st.sinceClose + deferred).toBeCloseTo(st.totalOwed, 2);
  });
});
