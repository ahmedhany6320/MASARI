import { describe, expect, it } from 'vitest';
import real from './__fixtures__/backup-2026-08-14.json';
import { bankBalance, cashBalance } from './balances';
import { cardPosition } from './card';
import { importBackup, parseBackup } from './importBackup';
import { overtimeTotal } from './overtime';

/**
 * These run against a REAL backup exported from the original PWA, not a
 * hand-written fixture. An importer verified only against data the same author
 * invented tends to pass right up until it meets a real file.
 */
describe('importBackup — real 14 Aug 2026 backup', () => {
  const res = importBackup(real);

  it('imports every transaction without dropping any', () => {
    expect(res.counts.transactions).toBe(44);
    expect(res.warnings.filter((w) => w.startsWith('skipped-tx'))).toHaveLength(0);
  });

  it('carries the account openings across', () => {
    expect(res.ledger.bankOpen).toBe(23800);
    expect(res.ledger.cashOpen).toBe(0);
    expect(res.ledger.base).toBe(11000);
  });

  it('reproduces the card position', () => {
    const cc = cardPosition(res.ledger);
    expect(res.ledger.cardSetup?.stmt0).toBe(1286);
    expect(cc.instBal).toBe(2653);
    // Opening unbilled was zero, so everything unbilled is card spending since
    // setup plus the recorded reconciliation.
    expect(cc.purch).toBeGreaterThan(0);
    expect(cc.utilized).toBeGreaterThan(0);
  });

  it('keeps the reconciliation entries as history without moving the bank twice', () => {
    // The card reconciliation lives in `cardAdj`; its ledger row is history
    // only and must not shift any balance.
    const withCardAdj = res.ledger.tx.filter((x) => x.type === 'cardadj');
    expect(withCardAdj).toHaveLength(1);

    const withoutIt = { ...res.ledger, tx: res.ledger.tx.filter((x) => x.type !== 'cardadj') };
    expect(bankBalance(res.ledger)).toBe(bankBalance(withoutIt));
  });

  it('applies the negative bank reconciliation', () => {
    const adjust = res.ledger.tx.find((x) => x.type === 'adjust');
    expect(adjust?.amt).toBeCloseTo(-1132.54, 2);
    // 23800 opening, less the corrections and money out, must land below it.
    expect(bankBalance(res.ledger)).toBeLessThan(23800);
  });

  it('nets the cash withdrawal and external cash income', () => {
    // 100 withdrawn from the bank, 100 external cash income.
    expect(cashBalance(res.ledger)).toBe(200);
  });

  it('does not re-apply the opening salary', () => {
    const salary = res.ledger.tx.find((x) => x.id === 's1');
    expect(salary?.post).toBe(false);
    expect(salary?.amt).toBe(11000);
  });

  it('imports people and their outstanding balances', () => {
    expect(res.counts.people).toBe(3);
    const settled = res.ledger.people.filter((p) => p.out === 0);
    const owing = res.ledger.people.filter((p) => p.out > 0);
    expect(settled).toHaveLength(1); // the 1000 that came back
    expect(owing.reduce((a, p) => a + p.out, 0)).toBe(600);
  });

  it('gives the goals real names instead of raw ids', () => {
    const egypt = res.ledger.goals.find((g) => g.id === 'egypt');
    expect(egypt?.ar).toBe('هدف مصر');
    expect(egypt?.target).toBe(1_100_000);
    expect(egypt?.currency).toBe('EGP');
  });

  it('imports the learned merchant rules', () => {
    expect(res.ledger.rules['famous']).toBe('c2');
    expect(res.ledger.rules['mango']).toBe('c1');
    expect(Object.keys(res.ledger.rules)).toHaveLength(7);
  });

  it('imports overtime and computes it correctly', () => {
    expect(res.counts.overtime).toBe(1);
    expect(overtimeTotal(res.ledger.otEntries)).toBeCloseTo(846.15, 2);
  });

  it('carries language, theme and the exchange rate', () => {
    expect(res.settings.lang).toBe('ar');
    expect(res.settings.theme).toBe('light');
    expect(res.settings.fxRate).toBe(13.6);
  });

  it('sorts transactions newest first', () => {
    const ts = res.ledger.tx.map((x) => x.ts);
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
  });

  it('leaves no transaction pointing at a missing category', () => {
    const ids = new Set(res.ledger.cats.map((c) => c.id));
    for (const x of res.ledger.tx) {
      if (x.cat) expect(ids.has(x.cat)).toBe(true);
    }
  });

  it('is idempotent — re-importing produces identical ids, not duplicates', () => {
    const again = importBackup(real);
    expect(again.ledger.tx.map((x) => x.id)).toEqual(res.ledger.tx.map((x) => x.id));
  });
});

describe('importBackup — robustness', () => {
  it('accepts a bare state object without the wrapper', () => {
    const res = importBackup({ bankOpen: 500, base: 9000 });
    expect(res.ledger.bankOpen).toBe(500);
    expect(res.ledger.base).toBe(9000);
  });

  it('returns an empty ledger rather than throwing on junk', () => {
    expect(importBackup(null).ledger.tx).toHaveLength(0);
    expect(importBackup({}).ledger.tx).toHaveLength(0);
    expect(importBackup([]).ledger.tx).toHaveLength(0);
  });

  it('skips malformed transactions instead of failing the whole import', () => {
    const res = importBackup({
      data: {
        tx: [
          { id: 'ok', ts: 1, type: 'expense', amt: 10 },
          { id: 'no-type', ts: 2, amt: 10 },
          { ts: 3, type: 'expense', amt: 10 },
          { id: 'bad-type', ts: 4, type: 'nonsense', amt: 10 },
        ],
      },
    });
    expect(res.ledger.tx).toHaveLength(1);
    expect(res.warnings).toContain('skipped-tx:3');
  });

  it('clears a category reference that no longer exists', () => {
    const res = importBackup({
      data: {
        cats: [{ id: 'c1', ar: 'أ', en: 'A' }],
        tx: [{ id: 't1', ts: 1, type: 'expense', amt: 5, cat: 'gone' }],
      },
    });
    expect(res.ledger.tx[0]?.cat).toBeNull();
    expect(res.warnings).toContain('orphaned-category:1');
  });

  it('distinguishes untracked cash from zero cash', () => {
    expect(importBackup({ data: { cashOpen: null } }).ledger.cashOpen).toBeNull();
    expect(importBackup({ data: { cashOpen: 0 } }).ledger.cashOpen).toBe(0);
  });

  it('clamps a statement day that would skip short months', () => {
    const res = importBackup({ data: { cardCfg: { limit: 100, closeDay: 31, dueDay: 30 } } });
    expect(res.ledger.cardCfg.closeDay).toBe(28);
    expect(res.ledger.cardCfg.dueDay).toBe(28);
  });

  it('treats a missing post flag as posting', () => {
    const res = importBackup({ data: { tx: [{ id: 't', ts: 1, type: 'income', amt: 5 }] } });
    expect(res.ledger.tx[0]?.post).toBe(true);
  });
});

describe('parseBackup', () => {
  it('parses valid backup text', () => {
    const res = parseBackup(JSON.stringify(real));
    expect(res?.counts.transactions).toBe(44);
  });

  it('returns null for text that is not JSON', () => {
    expect(parseBackup('not json at all')).toBeNull();
    expect(parseBackup('')).toBeNull();
  });
});
