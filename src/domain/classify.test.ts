import { describe, expect, it } from 'vitest';
import { discretionaryTotal, isDiscretionary, isOutgoing } from './classify';
import { emptyLedger } from './defaults';
import { dailyTotals, recommendFloor } from './floor';
import { burnRate } from './insights';
import type { Ledger, Tx } from './types';

let n = 0;
const id = () => `k-${++n}`;
const NOW = new Date(2026, 8, 13, 20, 0, 0);
const MONTH_START = new Date(2026, 8, 1).getTime();

const at = (day: number, amt: number, patch: Partial<Tx> = {}): Tx => ({
  id: `t${day}-${amt}`,
  ts: new Date(2026, 8, day, 12, 0).getTime(),
  type: 'expense',
  acct: 'card',
  amt,
  ...patch,
});

describe('what counts as spending', () => {
  it('a plain expense is discretionary', () => {
    expect(isDiscretionary(at(5, 40))).toBe(true);
  });

  it('a commitment settlement is an outgoing but not discretionary', () => {
    const rent = at(1, 1_800, { commitId: 'rent' });
    expect(isOutgoing(rent)).toBe(true);
    expect(isDiscretionary(rent)).toBe(false);
  });

  it('a non-posting row is neither — it is already in the opening balance', () => {
    const history = at(5, 40, { post: false });
    expect(isDiscretionary(history)).toBe(false);
    expect(isOutgoing(history)).toBe(false);
  });

  it('income and transfers are not spending', () => {
    expect(isDiscretionary({ ...at(5, 9_000), type: 'income' })).toBe(false);
    expect(isDiscretionary({ ...at(5, 850), type: 'remit' })).toBe(false);
    expect(isDiscretionary({ ...at(5, 1_200), type: 'ccpay' })).toBe(false);
  });

  it('totals only what it counts', () => {
    const l: Pick<Ledger, 'tx'> = {
      tx: [at(2, 40), at(1, 1_800, { commitId: 'rent' }), at(3, 60, { post: false }), at(4, 25)],
    };
    expect(discretionaryTotal(l, MONTH_START)).toBe(65);
  });
});

describe('the burn rate stops reporting the rent as an overrun', () => {
  function led(tx: Tx[]): Ledger {
    return { ...emptyLedger(id), base: 11_000, tx };
  }

  it('projects the month from discretionary spending alone', () => {
    // 13 days elapsed, 40 a day: 520 spent, projecting 1,200 for the month
    // against a 1,200 living pool. On plan, exactly.
    const days = Array.from({ length: 13 }, (_, i) => at(i + 1, 40));
    const b = burnRate(led(days), 1_200, NOW);
    expect(b.total).toBe(520);
    expect(b.projectedOverrun).toBeCloseTo(0, 2);
  });

  it('does not move when the rent is recorded', () => {
    // The bug: the rent went into `total` while `livingPool` has it taken out,
    // so the app announced an overrun the size of the rent every month.
    const days = Array.from({ length: 13 }, (_, i) => at(i + 1, 40));
    const withRent = [...days, at(1, 1_800, { commitId: 'rent' })];
    const before = burnRate(led(days), 1_200, NOW);
    const after = burnRate(led(withRent), 1_200, NOW);
    expect(after.total).toBe(before.total);
    expect(after.projectedOverrun).toBeCloseTo(before.projectedOverrun, 2);
  });
});

describe('the living floor is measured from living', () => {
  it('a settled bill does not raise the recommended floor', () => {
    // 90 days of ordinary spending, plus three rents.
    const from = NOW.getTime() - 90 * 864e5;
    const ordinary: Tx[] = [];
    for (let d = 0; d < 90; d++) {
      const ts = from + d * 864e5;
      ordinary.push({ id: `o${d}`, ts, type: 'expense', acct: 'card', amt: 30 + (d % 7) * 5 });
    }
    const rents: Tx[] = [0, 1, 2].map((m) => ({
      id: `r${m}`,
      ts: new Date(2026, 6 + m, 1, 9, 0).getTime(),
      type: 'expense',
      acct: 'bank',
      amt: 1_800,
      commitId: 'rent',
    }));

    const plain = recommendFloor({ tx: ordinary }, NOW, 90);
    const withRent = recommendFloor({ tx: [...ordinary, ...rents] }, NOW, 90);
    expect(withRent.floor).toBeCloseTo(plain.floor, 2);
  });

  it('leaves a day with only a bill on it reading as a zero-spend day', () => {
    const from = new Date(2026, 8, 1).getTime();
    const totals = dailyTotals(
      { tx: [at(1, 1_800, { commitId: 'rent' }), at(2, 45)] },
      from,
      new Date(2026, 8, 3).getTime(),
    );
    expect(totals[0]).toBe(0);
    expect(totals[1]).toBe(45);
  });
});
