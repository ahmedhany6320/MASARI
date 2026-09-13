import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { backupToText, buildBackup } from './exportBackup';
import { importBackup, parseBackup } from './importBackup';
import type { Ledger } from './types';

/**
 * Backup fidelity.
 *
 * The existing round-trip test exercises a real backup file — and that file
 * happens to carry none of the fields added since it was written, so it went
 * on passing while a restore silently dropped them.
 *
 * This fixture is built the other way round: every optional field on every
 * entity is populated, deliberately, so that adding a field to the ledger and
 * forgetting the importer fails here instead of in someone's real data.
 *
 * The two that matter most are `Tx.commitId` and `PlannedTransfer.sentFor`.
 * Losing either does not merely blank a value — it changes the arithmetic.
 * A settled rent that comes back without its `commitId` is charged twice: once
 * as the obligation, once as discretionary spending. A transfer that comes
 * back without its `sentFor` is budgeted for again in a cycle it already left.
 */

const SETTINGS = { lang: 'en' as const, theme: 'dark' as const, fxRate: 14.25 };
const NOW = new Date(2026, 8, 13, 9, 0, 0);

/** A ledger with nothing left at its default. */
function fullLedger(): Ledger {
  let n = 0;
  const id = () => `id-${++n}`;

  const rent = id();
  const net = id();
  const catFood = id();
  const catBills = id();

  return {
    ...emptyLedger(id),

    bankOpen: 12_345.67,
    cashOpen: 480.5,
    lastRecStr: '2026-09-01',

    cardCfg: { limit: 20_000, closeDay: 3, dueDay: 22 },
    cardSetup: {
      stmt0: 1_240.5,
      unbilled0: 108.98,
      instBal: 2_653,
      instMo: 221.08,
      setupAt: Date.UTC(2026, 5, 1),
    },
    cardAdj: -35.25,
    cardAdjNote: 'بنك أضاف رسوم تأخير',

    base: 9_500,
    salStatus: 'received',
    salActual: 9_712.4,
    otEntries: [{ id: id(), h: 6.5, rate: 45, mult: 1.5, date: '2026-09-05' }],

    cats: [
      { id: catFood, ar: 'بقالة', en: 'Groceries' },
      { id: catBills, ar: 'فواتير', en: 'Bills' },
    ],
    budgets: { [catFood]: 1_200, [catBills]: 2_100 },

    commits: [
      {
        id: rent,
        ar: 'الإيجار',
        en: 'Rent',
        amt: 1_800,
        day: 1,
        paused: false,
        paidMonth: true,
        paidFor: '2026-09',
        actual: 1_775,
      },
      {
        id: net,
        ar: 'الإنترنت',
        en: 'Internet',
        amt: 300,
        day: 18,
        paused: true,
        paidMonth: false,
        paidFor: null,
        actual: null,
      },
    ],

    people: [
      { id: id(), name: 'سامي', dir: 'owed', amt: 900, out: 400, fromAcct: 'cash' },
    ],

    recv: [
      { id: id(), ar: 'بدل سكن', en: 'Housing allowance', amt: 500, exact: false, status: 'expected', actual: null },
      { id: id(), ar: 'مكافأة', en: 'Bonus', amt: 1_000, exact: true, status: 'received', actual: 950 },
    ],

    goals: [
      // A renamed goal on the id the prototype hardcoded to EGP, holding AED.
      // If the importer still infers currency from the id, this is where it
      // corrupts someone's target.
      { id: 'egypt', ar: 'بيت العيلة', en: 'Family house', currency: 'AED', target: 60_000, alloc: 8_400, months: 18, extEgp: 0, auto: true },
      { id: id(), ar: 'مصر', en: 'Egypt', currency: 'EGP', target: 400_000, alloc: 1_250, months: 24, extEgp: 15_000, auto: false },
    ],

    planTf: [
      { id: id(), amt: 850, day: 20, sentFor: '2026-09' },
      { id: id(), amt: 300, day: 28, sentFor: null },
    ],

    tx: [
      {
        id: id(),
        ts: Date.UTC(2026, 8, 12, 8, 0),
        type: 'expense',
        cat: catBills,
        acct: 'bank',
        amt: 1_775,
        m: 'إيجار سبتمبر',
        mEn: 'September rent',
        post: true,
        commitId: rent,
      },
      {
        id: id(),
        ts: Date.UTC(2026, 8, 10, 19, 30),
        type: 'remit',
        cat: null,
        acct: 'bank',
        amt: 850,
        m: 'تحويل',
        mEn: 'Transfer',
        post: true,
        purpose: 'goal',
        fee: 18.5,
        rate: 14.2,
        to: 'والدتي',
      },
      {
        id: id(),
        ts: Date.UTC(2026, 8, 8, 12, 0),
        type: 'debtpay',
        cat: null,
        acct: 'cash',
        amt: 500,
        post: true,
        personId: 'id-6',
        back: 500,
      },
      {
        id: id(),
        ts: Date.UTC(2026, 7, 30, 7, 0),
        type: 'expense',
        cat: catFood,
        acct: 'card',
        amt: 63.25,
        post: false,
      },
    ],

    rules: { carrefour: catFood, du: catBills },
    savTarget: 2_000,
    baseline: { ts: Date.UTC(2026, 5, 1), cycleSpentBefore: 430.75 },
    minDailySpend: 20,
    comfortDailySpend: 40,
    bufferTarget: 1_500,
    goalMode: { egypt: 'horizon' },
    sslBasis: 'goal',
  };
}

describe('a backup carries the whole ledger', () => {
  const before = fullLedger();
  const text = backupToText(before, SETTINGS, NOW);
  const restored = parseBackup(text);

  it('parses', () => {
    expect(restored).not.toBeNull();
  });

  it('restores every field, not merely every row', () => {
    expect(restored!.ledger).toEqual(before);
  });

  it('restores the settings', () => {
    expect(restored!.settings).toEqual(SETTINGS);
  });

  it('keeps a settled commitment tied to the expense that settled it', () => {
    const rentId = before.commits[0]?.id;
    const paid = restored!.ledger.tx.find((x) => x.commitId != null);
    expect(paid?.commitId).toBe(rentId);
    expect(restored!.ledger.commits[0]?.actual).toBe(1_775);
    expect(restored!.ledger.commits[0]?.paidFor).toBe('2026-09');
  });

  it('keeps a transfer that has already been sent marked as sent', () => {
    expect(restored!.ledger.planTf[0]?.sentFor).toBe('2026-09');
    expect(restored!.ledger.planTf[1]?.sentFor).toBeNull();
  });

  it('does not infer a goal currency from its id when the goal states one', () => {
    const g = restored!.ledger.goals.find((x) => x.id === 'egypt');
    expect(g?.currency).toBe('AED');
    expect(g?.en).toBe('Family house');
  });

  it('keeps the reason the card was last corrected', () => {
    expect(restored!.ledger.cardAdjNote).toBe('بنك أضاف رسوم تأخير');
  });

  it('is idempotent — restoring twice changes nothing', () => {
    const again = parseBackup(backupToText(restored!.ledger, restored!.settings, NOW));
    expect(again!.ledger).toEqual(restored!.ledger);
    expect(buildBackup(again!.ledger, again!.settings, NOW)).toEqual(
      buildBackup(restored!.ledger, restored!.settings, NOW),
    );
  });
});

describe('a backup from the prototype still loads', () => {
  it('falls back to the id for a goal that carries no name or currency', () => {
    const res = importBackup({
      data: { goals: [{ id: 'egypt', target: 400_000, alloc: 100, months: 12 }] },
    });
    const g = res.ledger.goals[0];
    expect(g?.currency).toBe('EGP');
    expect(g?.en).toBe('Egypt goal');
  });

  it('leaves the new fields empty rather than inventing them', () => {
    const res = importBackup({ data: { commits: [{ id: 'c1', en: 'Rent', amt: 1800 }] } });
    expect(res.ledger.commits[0]?.actual).toBeNull();
    expect(res.ledger.cardAdjNote).toBeNull();
  });
});
