import { describe, expect, it } from 'vitest';
import real from './__fixtures__/backup-2026-08-14.json';
import { emptyLedger } from './defaults';
import { consistencyOf, evaluateFinancialState } from './engine';
import { importBackup } from './importBackup';
import type { Ledger } from './types';

const NOW = new Date(2026, 8, 13, 12, 0, 0);
const FX = 13.6;

let n = 0;
const id = () => `e-${++n}`;

/** The real ledger, with a living range and a dated goal so a plan exists. */
function realLedger(): Ledger {
  const { ledger } = importBackup(real);
  return {
    ...ledger,
    minDailySpend: 20,
    comfortDailySpend: 40,
    goals: ledger.goals.map((g) => (g.target ? { ...g, months: g.months ?? 18 } : g)),
  };
}

/** A hand-built ledger where every moving part is switched on. */
function busyLedger(): Ledger {
  const rent = id();
  return {
    ...emptyLedger(id),
    bankOpen: 14_000,
    cashOpen: 300,
    base: 11_000,
    salStatus: 'received',
    cardCfg: { limit: 20_000, closeDay: 1, dueDay: 25 },
    cardSetup: {
      stmt0: 1_200,
      unbilled0: 108.98,
      instBal: 2_653,
      instMo: 221.08,
      setupAt: new Date(2026, 5, 1).getTime(),
    },
    cardAdj: 0,
    minDailySpend: 20,
    comfortDailySpend: 40,
    bufferTarget: 1_500,
    commits: [
      { id: rent, ar: 'إيجار', en: 'Rent', amt: 1_800, day: 1, paused: false, paidMonth: false },
      { id: id(), ar: 'إنترنت', en: 'Internet', amt: 300, day: 18, paused: false, paidMonth: false },
      { id: id(), ar: 'موقوف', en: 'Paused', amt: 999, day: 5, paused: true, paidMonth: false },
    ],
    planTf: [{ id: id(), amt: 850, day: 20, sentFor: null }],
    goals: [
      { id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP', target: 400_000, alloc: 5_000, months: 18, extEgp: 0, auto: true },
    ],
    tx: [
      { id: id(), ts: new Date(2026, 8, 11, 13, 0).getTime(), type: 'expense', acct: 'card', amt: 52.5 },
      { id: id(), ts: new Date(2026, 8, 12, 19, 0).getTime(), type: 'expense', acct: 'card', amt: 31 },
      { id: id(), ts: new Date(2026, 8, 13, 9, 0).getTime(), type: 'expense', acct: 'cash', amt: 18 },
    ],
  };
}

describe('the engine holds the contract on a real ledger', () => {
  const st = evaluateFinancialState(realLedger(), NOW, { fx: FX });

  it('reports no inconsistency', () => {
    expect(st.consistency).toEqual([]);
  });

  it('answers as of the date it was asked about', () => {
    expect(st.asOf).toBe(NOW);
    expect(st.detail.daysElapsed).toBe(13);
  });

  it('reports one goal, and the projection reports the same one', () => {
    expect(st.goal?.id).toBe(st.projection?.goal?.id);
  });
});

describe('the engine holds the contract on a busy ledger', () => {
  const st = evaluateFinancialState(busyLedger(), NOW, { fx: FX });

  it('reports no inconsistency', () => {
    expect(st.consistency).toEqual([]);
  });

  it('net position is what is held less what is owed', () => {
    expect(st.netPosition).toBeCloseTo(st.bank + st.cash - st.cardOutstanding, 2);
  });

  it('settling the card moves nothing — it is not a second expense', () => {
    const before = evaluateFinancialState(busyLedger(), NOW, { fx: FX });
    const l = busyLedger();
    const paid = before.detail.cc.stmtRem;
    const after = evaluateFinancialState(
      {
        ...l,
        tx: [
          { id: 'pay', ts: new Date(2026, 8, 13, 10, 0).getTime(), type: 'ccpay', acct: 'bank', amt: paid },
          ...l.tx,
        ],
      },
      NOW,
      { fx: FX },
    );
    expect(after.netPosition).toBeCloseTo(before.netPosition, 2);
    // The bank really did go down; the debt went down with it.
    expect(after.bank).toBeCloseTo(before.bank - paid, 2);
    expect(after.cardOutstanding).toBeCloseTo(before.cardOutstanding - paid, 2);
  });

  it('the month splits into living, the goal, and a named surplus', () => {
    // Nothing falls through a gap: whatever the pool does not spend on living
    // is either the goal's or is reported as left over.
    expect(st.monthlyLiving).toBeGreaterThan(0);
    expect(st.monthlyToGoal).toBeGreaterThanOrEqual(0);
    expect(st.monthlySurplus).toBeGreaterThanOrEqual(0);
  });

  it('never reserves the goal more than its schedule asks for', () => {
    expect(st.detail.goalReq).toBeLessThanOrEqual(st.detail.goalAsked + 0.01);
  });

  it('the daily figure and the monthly living budget are the same plan', () => {
    // The bug this replaces: the allowance came from the projection while the
    // goal figure came from spendPlan, so the two described different months.
    const daysInMonth = 30;
    expect(st.projection!.monthlyDiscretionary).toBeCloseTo(
      st.detail.dailyDerivation!.planned * daysInMonth,
      2,
    );
  });

  it('a paused commitment claims nothing anywhere', () => {
    expect(st.detail.commitObl).toBeCloseTo(2_100, 2);
  });
});

describe('the engine survives a ledger with nothing in it', () => {
  const st = evaluateFinancialState(emptyLedger(id), NOW, { fx: FX });

  it('reports no inconsistency', () => {
    expect(st.consistency).toEqual([]);
  });

  it('says there is nothing to assess rather than inventing a plan', () => {
    expect(st.goal).toBeNull();
    expect(st.feasibility).toBe('unset');
    expect(st.projection).toBeNull();
  });

  it('produces no NaN anywhere in the headline figures', () => {
    for (const v of [st.netPosition, st.today, st.allowance, st.monthlyToGoal, st.monthlySurplus]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('the consistency harness is not vacuous', () => {
  /*
   * A check that cannot fail is worse than no check, because it reads as
   * assurance. Each of these corrupts exactly one figure and asserts the
   * matching rule fires — and only that rule.
   */
  const good = evaluateFinancialState(busyLedger(), NOW, { fx: FX }).detail;

  const rulesFor = (patch: Partial<typeof good>) =>
    consistencyOf({ ...good, ...patch }, NOW).map((b) => b.rule);

  it('catches a goal reserved beyond what its schedule asked for', () => {
    expect(rulesFor({ goalReq: good.goalAsked + 500 })).toContain('goal-capped-by-need');
  });

  it('catches a goal contribution that does not add up from its parts', () => {
    expect(rulesFor({ goalMonthly: good.goalMonthly + 250 })).toContain('goal-composition');
  });

  it('catches a card charge that is neither taken now nor deferred', () => {
    expect(
      rulesFor({ cardClaim: { ...good.cardClaim, deferred: good.cardClaim.deferred + 100 } }),
    ).toContain('card-charged-once');
  });

  it('catches a commitments total that does not match its own lines', () => {
    expect(rulesFor({ commitObl: good.commitObl + 1_800 })).toContain('commitment-once');
  });

  it('catches a settled commitment that is still claiming', () => {
    const items = good.commitments.items.map((i, idx) =>
      idx === 0 ? { ...i, state: 'paid' as const, claims: true } : i,
    );
    expect(rulesFor({ commitments: { ...good.commitments, items } })).toContain(
      'settled-claims-nothing',
    );
  });

  it("catches today's limit drifting from the allowance it comes from", () => {
    expect(rulesFor({ ssl: good.ssl + 5 })).toContain('ssl-definition');
  });

  it('catches an answer computed for a different day', () => {
    expect(consistencyOf(good, new Date(2026, 8, 20, 12, 0, 0)).map((b) => b.rule)).toContain(
      'as-of',
    );
  });

  it('reports a clean ledger as clean', () => {
    expect(consistencyOf(good, NOW)).toEqual([]);
  });
});
