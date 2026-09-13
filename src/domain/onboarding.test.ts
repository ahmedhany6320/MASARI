import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';

/**
 * A new ledger belongs to the person who opened it.
 *
 * Onboarding used to write Rent 1,800, Internet 300 and a monthly transfer of
 * 850 into every new ledger, after the preview and regardless of what was
 * entered. Those are the author's own figures. A stranger's first view of the
 * app was therefore someone else's rent, presented as their own — and the
 * preview shown a second earlier had not included any of it, so the first
 * number the app ever produced was one it immediately contradicted.
 *
 * These assert the absence, because absence is exactly the thing that silently
 * comes back.
 */
describe('a new ledger invents nothing', () => {
  let n = 0;
  const l = emptyLedger(() => `n-${++n}`);

  it('has no commitments', () => {
    expect(l.commits).toEqual([]);
  });

  it('has no planned transfers', () => {
    expect(l.planTf).toEqual([]);
  });

  it('has no goals, people, receivables or transactions', () => {
    expect(l.goals).toEqual([]);
    expect(l.people).toEqual([]);
    expect(l.recv).toEqual([]);
    expect(l.tx).toEqual([]);
  });

  it('has no salary, balance or card position', () => {
    expect(l.base).toBe(0);
    expect(l.bankOpen).toBe(0);
    expect(l.cashOpen).toBeNull();
    expect(l.cardSetup).toBeNull();
    expect(l.cardCfg.limit).toBe(0);
  });

  it('leaves every judgement figure unset rather than guessing one', () => {
    expect(l.minDailySpend).toBeNull();
    expect(l.comfortDailySpend).toBeNull();
    expect(l.bufferTarget).toBeNull();
    expect(l.savTarget).toBeNull();
    expect(l.baseline).toBeNull();
    expect(l.steerGoalId).toBeNull();
    // Absent, not 'salary': absent means automatic, which lets a dated goal
    // steer without the user first having to find a setting.
    expect(l.sslBasis).toBeUndefined();
  });

  it('offers category names, which are labels rather than amounts', () => {
    expect(l.cats.length).toBeGreaterThan(0);
    expect(l.budgets).toEqual({});
  });

  it('carries no amount anywhere in it', () => {
    // The blunt version of every assertion above: serialise the whole thing
    // and look for a number that is not zero.
    const amounts: number[] = [];
    JSON.stringify(l, (_k, v) => {
      if (typeof v === 'number') amounts.push(v);
      return v;
    });
    expect(amounts.filter((v) => v !== 0 && v !== 1 && v !== 25)).toEqual([]);
  });
});
