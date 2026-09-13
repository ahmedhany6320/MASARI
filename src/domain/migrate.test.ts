import { describe, expect, it } from 'vitest';
import {
  LEDGER_SCHEMA_VERSION,
  MIGRATIONS,
  migrateState,
  pendingMigrations,
} from './migrate';

describe('the migration chain', () => {
  it('is ordered and contiguous, ending at the declared version', () => {
    expect(MIGRATIONS.map((m) => m.to)).toEqual(
      MIGRATIONS.map((_, i) => i + 1),
    );
    expect(MIGRATIONS.at(-1)?.to).toBe(LEDGER_SCHEMA_VERSION);
  });

  it('every step says why it exists', () => {
    for (const m of MIGRATIONS) expect(m.reason.length).toBeGreaterThan(20);
  });

  it('does nothing to a save already at the current version', () => {
    const state = { ledger: { sslBasis: 'salary', base: 9000 } };
    expect(migrateState(state, LEDGER_SCHEMA_VERSION)).toEqual(state);
    expect(pendingMigrations(LEDGER_SCHEMA_VERSION)).toEqual([]);
  });

  it('leaves a save from a newer build alone rather than mangling it', () => {
    const future = { ledger: { sslBasis: 'salary', somethingNew: 42 } };
    expect(migrateState(future, LEDGER_SCHEMA_VERSION + 5)).toEqual(future);
  });

  it('survives a save that is missing, empty or not an object', () => {
    expect(migrateState(null, 0)).toEqual({});
    expect(migrateState(undefined, 0)).toEqual({});
    expect(migrateState('nonsense', 0)).toEqual({});
    expect(migrateState({}, 0)).toEqual({});
    expect(migrateState({ ledger: null }, 0)).toEqual({ ledger: null });
  });
});

describe('v1 — the stale salary basis', () => {
  it('clears the basis that older builds stamped in automatically', () => {
    const out = migrateState({ ledger: { sslBasis: 'salary', base: 9000 } }, 0);
    expect((out.ledger as Record<string, unknown>).sslBasis).toBeUndefined();
    expect((out.ledger as Record<string, unknown>).base).toBe(9000);
  });

  it('leaves a basis the user actually chose', () => {
    for (const basis of ['balance', 'goal']) {
      const out = migrateState({ ledger: { sslBasis: basis } }, 0);
      expect((out.ledger as Record<string, unknown>).sslBasis).toBe(basis);
    }
  });

  it('runs once, so choosing the salary cycle later sticks', () => {
    // The old code lived in `merge` and ran on every launch: pick the salary
    // cycle deliberately, restart the app, and the choice was silently undone.
    const migrated = migrateState({ ledger: { sslBasis: 'salary' } }, 0);
    const chosen = { ...migrated, ledger: { sslBasis: 'salary' } };
    expect(migrateState(chosen, LEDGER_SCHEMA_VERSION)).toEqual(chosen);
  });

  it('touches nothing else in the save', () => {
    const state = {
      ledger: { sslBasis: 'salary', tx: [{ id: 'a' }], goals: [{ id: 'g' }] },
      settings: { lang: 'ar' },
    };
    const out = migrateState(state, 0);
    expect(out.settings).toEqual({ lang: 'ar' });
    expect((out.ledger as Record<string, unknown>).tx).toEqual([{ id: 'a' }]);
    expect((out.ledger as Record<string, unknown>).goals).toEqual([{ id: 'g' }]);
  });
});
