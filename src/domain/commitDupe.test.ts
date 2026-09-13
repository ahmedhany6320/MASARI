import { describe, expect, it } from 'vitest';
import { commitmentsDue } from './commitments';
import { emptyLedger, DEFAULT_COMMITMENTS } from './defaults';
import { simulate, type ProjectionInput } from './projection';
import type { Commitment, Ledger } from './types';

const NOW = new Date(2026, 8, 13, 12, 0, 0);

function commit(id: string, ar: string, en: string, amt: number, day: number, over: Partial<Commitment> = {}): Commitment {
  return { id, ar, en, amt, day, paused: false, paidMonth: false, ...over };
}
function led(commits: Commitment[]): Ledger {
  return { ...emptyLedger(), base: 11000, commits };
}
function inp(ledger: Ledger): ProjectionInput {
  return { ledger, fx: 13.6, now: NOW, range: { min: 20, comfort: 40 } };
}

describe('a commitment is never counted twice', () => {
  it('counts each line once in the cycle total', () => {
    const d = commitmentsDue(
      [commit('r', 'إيجار', 'Rent', 1800, 1), commit('n', 'نت', 'Internet', 300, 18)],
      NOW,
    );
    expect(d.total).toBe(2100);
    expect(d.items).toHaveLength(2);
  });

  it('drops it from the cycle once settled, and does not also leave it pending', () => {
    const d = commitmentsDue(
      [
        commit('r', 'إيجار', 'Rent', 1800, 1, { paidFor: '2026-09' }),
        commit('n', 'نت', 'Internet', 300, 18),
      ],
      NOW,
    );
    expect(d.total).toBe(300);
    expect(d.paid).toBe(1800);
    // Settled and pending are disjoint: 1,800 appears in exactly one of them.
    expect(d.overdue + d.upcoming).toBe(300);
  });

  it('charges September once in the projection, then charges October afresh', () => {
    // The specific error: September's rent arriving twice. It is charged in
    // month 0 only while unsettled, and every later month carries the plan.
    const unpaid = simulate(inp(led([commit('r', 'إيجار', 'Rent', 1800, 1)])), 40, 3);
    expect(unpaid[0]?.commitments).toBe(1800);
    expect(unpaid[1]?.commitments).toBe(1800);

    const paid = simulate(
      inp(led([commit('r', 'إيجار', 'Rent', 1800, 1, { paidFor: '2026-09' })])),
      40,
      3,
    );
    expect(paid[0]?.commitments).toBe(0);
    expect(paid[1]?.commitments).toBe(1800);
  });

  it('ignores a paused line everywhere, not just in one place', () => {
    const l = led([
      commit('r', 'إيجار', 'Rent', 1800, 1, { paused: true }),
      commit('n', 'نت', 'Internet', 300, 18),
    ]);
    expect(commitmentsDue(l.commits, NOW).total).toBe(300);
    expect(simulate(inp(l), 40, 2)[1]?.commitments).toBe(300);
  });

  it('holds the same total however many times the list is re-read', () => {
    const l = led(DEFAULT_COMMITMENTS.map((d, i) =>
      commit(`k${i}`, d.ar, d.en, d.amt, d.day),
    ));
    const a = commitmentsDue(l.commits, NOW).total;
    const b = commitmentsDue(l.commits, NOW).total;
    expect(a).toBe(b);
    expect(a).toBe(DEFAULT_COMMITMENTS.reduce((x, d) => x + d.amt, 0));
  });
});
