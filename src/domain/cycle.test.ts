import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { overtimeForCycle, overtimeThisCycle, salaryCycle } from './cycle';
import type { Ledger, OvertimeEntry } from './types';

let n = 0;
const id = () => `c-${++n}`;

const SEP = new Date(2026, 8, 13, 12, 0, 0);
const OCT = new Date(2026, 9, 5, 12, 0, 0);

function led(patch: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(id), base: 9_500, ...patch };
}

describe('the salary status expires with its month', () => {
  it('honours a status stamped with this cycle', () => {
    const s = salaryCycle(led({ salStatus: 'received', salActual: 9_800, salFor: '2026-09' }), SEP);
    expect(s.status).toBe('received');
    expect(s.actual).toBe(9_800);
    expect(s.amount).toBe(9_800);
    expect(s.stale).toBe(false);
  });

  it('ignores a status stamped with an earlier cycle', () => {
    // The bug: ticking September left the app claiming October had landed too,
    // so the prompt to confirm it never came back.
    const s = salaryCycle(led({ salStatus: 'received', salActual: 9_800, salFor: '2026-09' }), OCT);
    expect(s.status).toBe('expected');
    expect(s.actual).toBeNull();
    expect(s.amount).toBe(9_500);
    expect(s.stale).toBe(true);
  });

  it('does not carry one good month into the next', () => {
    // salActual of 9,800 was September's overtime-boosted pay. October budgets
    // from the base until October's own pay lands.
    expect(salaryCycle(led({ salStatus: 'received', salActual: 9_800, salFor: '2026-09' }), OCT).amount)
      .toBe(9_500);
  });

  it('reads an unstamped status as current, then lets it lapse', () => {
    // Saves written before salFor existed. The user did tick it, so honour it
    // now; from the next month on, an absent stamp is a stale one.
    const legacy = led({ salStatus: 'received', salActual: 9_700, salFor: null });
    expect(salaryCycle(legacy, SEP).status).toBe('received');
    expect(salaryCycle(legacy, SEP).amount).toBe(9_700);
  });

  it('falls back to the base salary when nothing has landed', () => {
    const s = salaryCycle(led({ salStatus: 'expected', salActual: null, salFor: null }), SEP);
    expect(s.amount).toBe(9_500);
    expect(s.stale).toBe(false);
  });

  it('ignores a nonsense actual rather than budgeting from it', () => {
    const s = salaryCycle(led({ salStatus: 'received', salActual: 0, salFor: '2026-09' }), SEP);
    expect(s.amount).toBe(9_500);
  });

  it('reports the cycle it answered for', () => {
    expect(salaryCycle(led(), SEP).cycle).toBe('2026-09');
    expect(salaryCycle(led(), OCT).cycle).toBe('2026-10');
  });
});

describe('overtime belongs to the month it was worked', () => {
  const entries: OvertimeEntry[] = [
    { id: 'a', h: 6, rate: 40, mult: 1.5, date: '2026-09-02' },
    { id: 'b', h: 4, rate: 40, mult: 1.25, date: '2026-09-20' },
    { id: 'c', h: 10, rate: 40, mult: 2, date: '2026-06-11' },
  ];

  it('counts only this cycle', () => {
    // The bug: every entry ever recorded was summed and shown as this month's
    // overtime, so a good June was still being paid out on screen in December.
    expect(overtimeThisCycle(entries, SEP)).toBe(6 * 40 * 1.5 + 4 * 40 * 1.25);
    expect(overtimeForCycle(entries, SEP).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('reports nothing for a month with no overtime', () => {
    expect(overtimeThisCycle(entries, OCT)).toBe(0);
    expect(overtimeForCycle(entries, OCT)).toEqual([]);
  });

  it('ignores an entry with no usable date rather than crediting it', () => {
    expect(overtimeThisCycle([{ id: 'x', h: 5, rate: 40, mult: 1, date: '' }], SEP)).toBe(0);
  });
});
