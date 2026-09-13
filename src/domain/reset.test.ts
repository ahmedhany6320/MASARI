import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { importBackup } from './importBackup';
import { safeSpend } from './safeSpend';
import real from './__fixtures__/backup-2026-08-14.json';

const NOW = new Date(2026, 7, 14, 12, 0, 0);

describe('a factory reset leaves nothing behind', () => {
  it('clears every field the app writes, including the newer ones', () => {
    // A ledger loaded with real history, then reset. Anything still set here
    // would resurface after the next launch via the persistence merge.
    const { ledger } = importBackup(real);
    expect(ledger.tx.length).toBeGreaterThan(0);

    const fresh = emptyLedger();
    expect(fresh.tx).toEqual([]);
    expect(fresh.base).toBe(0);
    expect(fresh.bankOpen).toBe(0);
    expect(fresh.cardSetup).toBeNull();
    expect(fresh.commits).toEqual([]);
    expect(fresh.goals).toEqual([]);
    expect(fresh.people).toEqual([]);
    expect(fresh.recv).toEqual([]);
    expect(fresh.planTf).toEqual([]);
    expect(fresh.otEntries).toEqual([]);
    expect(fresh.budgets).toEqual({});
    expect(fresh.rules).toEqual({});
    expect(fresh.savTarget).toBeNull();
    expect(fresh.minDailySpend).toBeNull();
    expect(fresh.baseline).toBeNull();
    expect(fresh.goalMode).toEqual({});
  });

  it('serialises with no key silently missing', () => {
    // The persistence layer round-trips through JSON, which drops `undefined`.
    // A key absent here is a key the merge would refill from the old save.
    const round = JSON.parse(JSON.stringify(emptyLedger()));
    for (const k of ['minDailySpend', 'baseline', 'goalMode', 'cardSetup', 'savTarget']) {
      expect(Object.hasOwn(round, k)).toBe(true);
    }
  });

  it('produces a limit of zero rather than a broken one', () => {
    const c = safeSpend(emptyLedger(), 13.6, NOW);
    expect(c.ssl).toBe(0);
    expect(c.livingPool).toBe(0);
    expect(c.cardDue).toBe(0);
    expect(c.cardClaim.totalOwed).toBe(0);
    expect(Number.isFinite(c.allowance)).toBe(true);
  });

  it('keeps the default categories, which are scaffolding not data', () => {
    expect(emptyLedger().cats.length).toBeGreaterThan(0);
  });
});
