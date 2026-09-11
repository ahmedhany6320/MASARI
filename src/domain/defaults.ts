import type { Category, Ledger } from './types';

export const DEFAULT_FX_RATE = 13.6;

/**
 * Fallback id source, used only when no generator is supplied. Deliberately
 * not a UUID: sync skips non-UUID ids, so a ledger built without the app's
 * generator degrades to local-only rather than sending Postgres a key it will
 * reject.
 */
let seq = 0;
function defaultId(): string {
  seq += 1;
  return `local-${seq}`;
}

/** Category names, without ids — the caller supplies those. */
export const DEFAULT_CATEGORY_NAMES: Omit<Category, 'id'>[] = [
  { ar: 'بقالة', en: 'Groceries' },
  { ar: 'مطاعم', en: 'Restaurants' },
  { ar: 'مواصلات', en: 'Transport' },
  { ar: 'فواتير والتزامات', en: 'Bills & commitments' },
  { ar: 'صحة', en: 'Health' },
  { ar: 'ترفيه', en: 'Entertainment' },
  { ar: 'أخرى', en: 'Other' },
];

/**
 * The obligations a new ledger starts with.
 *
 * Seeded rather than left empty because an app that opens with no commitments
 * quietly reports the whole salary as available, which is wrong for everyone
 * and dangerously wrong as a first impression. Every figure here is a plan the
 * user edits, and the amounts are only ever a starting point — what actually
 * gets paid is recorded separately, and the difference goes to the goal.
 */
export const DEFAULT_COMMITMENTS: { ar: string; en: string; amt: number; day: number }[] = [
  { ar: 'الإيجار', en: 'Rent', amt: 1800, day: 1 },
  { ar: 'الإنترنت', en: 'Internet', amt: 300, day: 18 },
];

/** The monthly transfer home, as a plan. */
export const DEFAULT_PLANNED_TRANSFER = 850;

/**
 * A brand-new, empty ledger.
 *
 * Unlike the prototype — which shipped one specific person's real figures as
 * its starting state — this is genuinely blank. Onboarding fills it in, which
 * is what makes the app usable by someone other than its author.
 *
 * `makeId` is injected so this module stays free of any id implementation. The
 * app passes a UUID generator, because ids are used verbatim as Postgres
 * primary keys during sync; tests can pass a counter for readable output.
 */
export function emptyLedger(makeId: () => string = defaultId): Ledger {
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

    cats: DEFAULT_CATEGORY_NAMES.map((c) => ({ ...c, id: makeId() })),
    budgets: {},
    commits: [],
    people: [],
    recv: [],
    goals: [],
    planTf: [],
    tx: [],
    rules: {},

    savTarget: null,

    // Stated explicitly rather than left undefined so a factory reset provably
    // clears them: `JSON.stringify` drops undefined keys, which would leave a
    // stale value to be merged back in on the next launch.
    minDailySpend: null,
    comfortDailySpend: null,
    bufferTarget: null,
    baseline: null,
    goalMode: {},
    // Deliberately NOT set: absent means automatic, which lets a goal with a
    // duration steer spending without the user first finding a setting.
    sslBasis: undefined,
  };
}
