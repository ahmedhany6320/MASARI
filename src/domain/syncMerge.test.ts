import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { mergeRelationalPull } from './syncMerge';
import type { Ledger } from './types';

/**
 * The bug these cover: a pull replaces the device's state, and the remote
 * tables have never held every field. Before this, pulling erased overtime,
 * receivables, planned transfers and rules, and stripped `commitId` off every
 * transaction — which does not merely lose a value, it charges a settled rent
 * a second time.
 */

let n = 0;
const id = () => `id-${++n}`;

/** What the device holds: everything. */
function local(): Ledger {
  return {
    ...emptyLedger(id),
    cardAdjNote: 'رسوم تأخير',
    salStatus: 'received',
    salActual: 9_800,
    salFor: '2026-09',
    otEntries: [{ id: 'ot1', h: 5, rate: 40, mult: 1.5, date: '2026-09-02' }],
    recv: [
      { id: 'r1', ar: 'بدل', en: 'Allowance', amt: 500, exact: true, status: 'expected', actual: null },
    ],
    planTf: [{ id: 'tf1', amt: 850, day: 20, sentFor: '2026-09' }],
    rules: { carrefour: 'cat-food' },
    baseline: { ts: 1_700_000_000_000, cycleSpentBefore: 120 },
    minDailySpend: 20,
    comfortDailySpend: 40,
    bufferTarget: 1_500,
    goalMode: { egypt: 'horizon' },
    commits: [
      {
        id: 'c1', ar: 'إيجار', en: 'Rent', amt: 1800, day: 1, paused: false,
        paidMonth: true, paidFor: '2026-09', actual: 1775,
        history: [
          { cycle: '2026-08', actual: 1800, ts: 1 },
          { cycle: '2026-09', actual: 1775, ts: 2 },
        ],
      },
    ],
    tx: [
      { id: 'x1', ts: 1_000, type: 'expense', acct: 'bank', amt: 1775, commitId: 'c1' },
      { id: 'x2', ts: 900, type: 'remit', acct: 'bank', amt: 850, fee: 18.5, rate: 14.2, to: 'والدتي' },
      { id: 'x3', ts: 800, type: 'debtpay', acct: 'cash', amt: 500, back: 500 },
    ],
  };
}

/** What an older remote can actually return: the same rows, minus the gaps. */
function relationalRemote(): Ledger {
  return {
    ...emptyLedger(id),
    bankOpen: 7_777,
    base: 9_500,
    commits: [
      { id: 'c1', ar: 'إيجار', en: 'Rent', amt: 1800, day: 1, paused: false, paidMonth: true, paidFor: '2026-09' },
    ],
    tx: [
      { id: 'x1', ts: 1_000, type: 'expense', acct: 'bank', amt: 1775 },
      { id: 'x2', ts: 900, type: 'remit', acct: 'bank', amt: 850 },
      { id: 'x3', ts: 800, type: 'debtpay', acct: 'cash', amt: 500 },
    ],
  };
}

describe('a pull never blanks a field the remote cannot carry', () => {
  const merged = mergeRelationalPull(relationalRemote(), local());
  const l = local();

  it('keeps overtime, receivables, planned transfers and rules', () => {
    expect(merged.otEntries).toEqual(l.otEntries);
    expect(merged.recv).toEqual(l.recv);
    expect(merged.planTf).toEqual(l.planTf);
    expect(merged.rules).toEqual(l.rules);
  });

  it('keeps the scalars no column exists for', () => {
    expect(merged.cardAdjNote).toBe('رسوم تأخير');
    expect(merged.baseline).toEqual(l.baseline);
    expect(merged.minDailySpend).toBe(20);
    expect(merged.comfortDailySpend).toBe(40);
    expect(merged.bufferTarget).toBe(1_500);
    expect(merged.goalMode).toEqual({ egypt: 'horizon' });
  });

  it('keeps the settlement history and the salary cycle stamp', () => {
    expect(merged.commits.find((k) => k.id === 'c1')?.history?.map((h) => h.cycle)).toEqual([
      '2026-08',
      '2026-09',
    ]);
    // Without the stamp an unstamped status reads as current, so a pull would
    // re-assert a salary that landed months ago.
    expect(merged.salFor).toBe('2026-09');
  });

  it('keeps a settled expense tied to its commitment', () => {
    // Without this, the rent is counted as discretionary spending AND the
    // commitment is charged again — the same 1,775 twice.
    expect(merged.tx.find((x) => x.id === 'x1')?.commitId).toBe('c1');
    expect(merged.commits.find((k) => k.id === 'c1')?.actual).toBe(1_775);
  });

  it('keeps the transfer details that make history reproducible', () => {
    const remit = merged.tx.find((x) => x.id === 'x2');
    expect(remit?.fee).toBe(18.5);
    expect(remit?.rate).toBe(14.2);
    expect(remit?.to).toBe('والدتي');
    expect(merged.tx.find((x) => x.id === 'x3')?.back).toBe(500);
  });
});

describe('the remote still wins on everything it can carry', () => {
  it('takes the remote balances and salary', () => {
    const merged = mergeRelationalPull(relationalRemote(), local());
    expect(merged.bankOpen).toBe(7_777);
    expect(merged.base).toBe(9_500);
  });

  it('takes a remote row that the device does not have', () => {
    const remote = relationalRemote();
    remote.tx = [...remote.tx, { id: 'x9', ts: 500, type: 'expense', acct: 'bank', amt: 30 }];
    const merged = mergeRelationalPull(remote, local());
    expect(merged.tx.find((x) => x.id === 'x9')?.amt).toBe(30);
    expect(merged.tx.find((x) => x.id === 'x9')?.commitId).toBeUndefined();
  });

  it('drops a row the remote no longer has — a deletion is not a gap', () => {
    const remote = relationalRemote();
    remote.tx = remote.tx.filter((x) => x.id !== 'x3');
    const merged = mergeRelationalPull(remote, local());
    expect(merged.tx.map((x) => x.id)).toEqual(['x1', 'x2']);
  });

  it('does not resurrect a field the remote changed to a real value', () => {
    const remote = relationalRemote();
    remote.commits = remote.commits.map((k) => ({ ...k, paidFor: null, paidMonth: false }));
    const merged = mergeRelationalPull(remote, local());
    expect(merged.commits[0]?.paidFor).toBeNull();
    // `actual` still has no column, so it is still filled from the device.
    expect(merged.commits[0]?.actual).toBe(1_775);
  });
});

describe('edge cases', () => {
  it('survives an empty device', () => {
    const merged = mergeRelationalPull(relationalRemote(), emptyLedger(id));
    expect(merged.otEntries).toEqual([]);
    expect(merged.tx.find((x) => x.id === 'x1')?.commitId).toBeUndefined();
  });

  it('survives an empty remote without wiping the device', () => {
    const l = local();
    const merged = mergeRelationalPull(emptyLedger(id), l);
    expect(merged.tx).toEqual([]);
    expect(merged.recv).toEqual(l.recv);
    expect(merged.planTf).toEqual(l.planTf);
  });

  it('is idempotent', () => {
    const once = mergeRelationalPull(relationalRemote(), local());
    const twice = mergeRelationalPull(once, local());
    expect(twice).toEqual(once);
  });
});
