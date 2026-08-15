import type { Category, Ledger } from './types';

export const DEFAULT_FX_RATE = 13.6;

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'c1', ar: 'بقالة', en: 'Groceries' },
  { id: 'c2', ar: 'مطاعم', en: 'Restaurants' },
  { id: 'c3', ar: 'مواصلات', en: 'Transport' },
  { id: 'c4', ar: 'فواتير والتزامات', en: 'Bills & commitments' },
  { id: 'c5', ar: 'صحة', en: 'Health' },
  { id: 'c6', ar: 'ترفيه', en: 'Entertainment' },
  { id: 'c7', ar: 'أخرى', en: 'Other' },
];

/**
 * A brand-new, empty ledger.
 *
 * Unlike the prototype — which shipped one specific person's real figures as
 * its starting state — this is genuinely blank. Onboarding fills it in, which
 * is what makes the app usable by someone other than its author.
 */
export function emptyLedger(): Ledger {
  return {
    bankOpen: 0,
    cashOpen: null,
    lastRecStr: null,

    // Statement for a month's spending is issued on the 1st of the NEXT month
    // and is payable up to the 25th.
    cardCfg: { limit: 0, closeDay: 1, dueDay: 25 },
    cardSetup: null,
    cardAdj: 0,

    base: 0,
    salStatus: 'expected',
    salActual: null,
    otEntries: [],

    cats: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    budgets: {},
    commits: [],
    people: [],
    recv: [],
    goals: [],
    planTf: [],
    tx: [],
    rules: {},

    savTarget: null,
  };
}
