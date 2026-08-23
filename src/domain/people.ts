import type { Ledger, Person, Tx } from './types';

/**
 * Debt tracking between people.
 *
 * The prototype stored only a running `outstanding` figure, which is enough to
 * display but not enough to TRUST: when someone asks "wait, how much did I
 * actually lend you", a single number with no history behind it is exactly the
 * thing that starts an argument. These helpers reconstruct the trail.
 */

export interface PersonEntry {
  tx: Tx;
  /** Whether this moved the debt up or down. */
  direction: 'increase' | 'decrease';
  /** Outstanding balance after this entry. */
  runningOut: number;
}

/**
 * Every ledger entry touching this person, oldest first, with the running
 * balance after each.
 *
 * Entries are matched by `personId`; the original loan has no such reference
 * in older ledgers, so the opening principal is used as the starting point
 * rather than assuming the list is complete.
 */
export function personHistory(ledger: Ledger, person: Person): PersonEntry[] {
  const rows = ledger.tx
    .filter((x) => x.personId === person.id)
    .sort((a, b) => a.ts - b.ts);

  let running = person.amt;
  const out: PersonEntry[] = [];

  for (const tx of rows) {
    // For someone the user LENT to, income is repayment. For someone they owe,
    // a debtpay reduces it. Both lower the outstanding balance.
    const decrease = tx.type === 'income' || tx.type === 'debtpay';
    running = decrease
      ? Math.max(0, running - tx.amt)
      : running + tx.amt;
    out.push({ tx, direction: decrease ? 'decrease' : 'increase', runningOut: running });
  }

  return out;
}

export interface DebtSummary {
  /** Total the user owes others. */
  owed: number;
  /** Total others owe the user. */
  owedToMe: number;
  /** `owedToMe − owed`. Positive means the user is a net lender. */
  net: number;
  /** People with anything outstanding. */
  activeCount: number;
  /** Largest single outstanding amount, in either direction. */
  largest: { name: string; amount: number; dir: 'owe' | 'owed' } | null;
  /** Fully settled, kept for history. */
  settledCount: number;
}

export function debtSummary(ledger: Ledger): DebtSummary {
  const active = ledger.people.filter((x) => x.out > 0);
  const owed = active.filter((x) => x.dir === 'owe').reduce((a, x) => a + x.out, 0);
  const owedToMe = active.filter((x) => x.dir === 'owed').reduce((a, x) => a + x.out, 0);

  const biggest = [...active].sort((a, b) => b.out - a.out)[0];

  return {
    owed,
    owedToMe,
    net: owedToMe - owed,
    activeCount: active.length,
    largest: biggest ? { name: biggest.name, amount: biggest.out, dir: biggest.dir } : null,
    settledCount: ledger.people.length - active.length,
  };
}

/**
 * How much of the original principal has come back, 0–1.
 *
 * A person added with a zero principal reports zero rather than dividing by
 * it — that happens when a debt is recorded after the fact.
 */
export function repaidRatio(person: Person): number {
  if (person.amt <= 0) return 0;
  return Math.min(1, Math.max(0, (person.amt - person.out) / person.amt));
}
