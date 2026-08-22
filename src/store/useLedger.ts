import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { uuid } from '../lib/id';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_FX_RATE,
  emptyLedger,
  type Account,
  type CardConfig,
  type CardSetup,
  type Commitment,
  type Goal,
  type Lang,
  type Ledger,
  type OvertimeEntry,
  type Person,
  type PlannedTransfer,
  type Receivable,
  type SalaryStatus,
  type Theme,
  type Tx,
  type TxType,
} from '../domain';

/** When the scheduled local notifications fire, and which ones. */
export interface Reminders {
  /** Daily brief with today's safe spend limit. */
  morning: boolean;
  morningHour: number;
  /** Evening alert, sent only on a day that went over. */
  evening: boolean;
  eveningHour: number;
  /** Heads-up on commitments falling due. */
  commitments: boolean;
}

/** Settings live alongside the ledger but are deliberately not part of it. */
export interface Settings {
  lang: Lang;
  theme: Theme;
  /** EGP per AED. */
  fxRate: number;
  onboarded: boolean;
  /** Require device biometrics on launch. */
  biometricLock: boolean;
  reminders: Reminders;
}

export interface LedgerStore {
  ledger: Ledger;
  settings: Settings;
  /** False until the persisted state has been read back from disk. */
  hydrated: boolean;

  setLang: (lang: Lang) => void;
  setTheme: (theme: Theme) => void;
  setFxRate: (rate: number) => void;
  setBiometricLock: (on: boolean) => void;
  setReminders: (patch: Partial<Reminders>) => void;
  completeOnboarding: (init: Partial<Ledger>) => void;

  addTx: (tx: Omit<Tx, 'id'>) => void;
  removeTx: (id: string) => void;
  /** Quick-add: the common case of recording a spend. */
  spend: (args: { amt: number; cat?: string | null; acct?: Account; memo?: string }) => void;

  setBase: (base: number) => void;
  setBankOpen: (amt: number) => void;
  setCashOpen: (amt: number | null) => void;

  addCommitment: (c: Omit<Commitment, 'id'>) => void;
  updateCommitment: (id: string, patch: Partial<Commitment>) => void;
  removeCommitment: (id: string) => void;

  addGoal: (g: Omit<Goal, 'id'>) => void;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  removeGoal: (id: string) => void;

  addPerson: (p: Omit<Person, 'id'>) => void;
  updatePerson: (id: string, patch: Partial<Person>) => void;
  removePerson: (id: string) => void;

  addReceivable: (r: Omit<Receivable, 'id'>) => void;
  updateReceivable: (id: string, patch: Partial<Receivable>) => void;
  removeReceivable: (id: string) => void;
  /** Marks a receivable arrived, posting the money into an account. */
  receiveReceivable: (id: string, actual: number, acct: Account) => void;

  addPlannedTransfer: (t: Omit<PlannedTransfer, 'id'>) => void;
  removePlannedTransfer: (id: string) => void;
  /** Records an executed international transfer, moving money out of the bank. */
  sendTransfer: (args: { amt: number; purpose?: string; memo?: string; goalId?: string; egp?: number }) => void;

  addOvertime: (e: Omit<OvertimeEntry, 'id'>) => void;
  removeOvertime: (id: string) => void;

  setCardSetup: (setup: CardSetup | null) => void;
  setCardConfig: (cfg: Partial<CardConfig>) => void;
  /** Reconciles the card, logging the correction as an auditable entry. */
  reconcileCard: (delta: number, reason: string) => void;
  /** Records a payment against the card statement. */
  payCard: (amt: number, acct: Account) => void;

  setSalaryStatus: (status: SalaryStatus, actual?: number | null) => void;
  /**
   * Declares the real position right now and starts counting from here,
   * instead of demanding weeks of back-filled history.
   */
  startFromToday: (snapshot: {
    bank: number;
    cash: number | null;
    cardStatement: number;
    cardUnbilled: number;
    instBal: number;
    instMo: number;
    spentThisCycle: number;
  }) => void;
  setSavingsTarget: (target: number | null) => void;
  /** The least the user can live on per day — goals may never breach it. */
  setMinDailySpend: (amount: number | null) => void;
  /** How a goal is pursued: fixed amount+date, stretch the date, or fix the date. */
  setGoalMode: (goalId: string, mode: 'fixed' | 'stretch' | 'horizon') => void;

  addCategory: (ar: string, en: string) => void;
  removeCategory: (id: string) => void;

  /** Settles money owed to or by a person. */
  settlePerson: (id: string, amt: number, acct: Account) => void;

  setBudget: (catId: string, amount: number | null) => void;
  learnRule: (merchant: string, catId: string) => void;

  /** Wipes everything back to a blank ledger. */
  reset: () => void;
  /** Replaces local state wholesale — used by restore and by cloud pull. */
  replaceAll: (ledger: Ledger, settings?: Partial<Settings>) => void;
}

const DEFAULT_SETTINGS: Settings = {
  lang: 'ar',
  theme: 'light',
  fxRate: DEFAULT_FX_RATE,
  onboarded: false,
  biometricLock: false,
  reminders: {
    morning: true,
    morningHour: 9,
    evening: true,
    eveningHour: 21,
    commitments: true,
  },
};

/**
 * Ids are UUIDs rather than readable prefixed strings, because they are used
 * verbatim as Postgres primary keys during sync — see `src/lib/id.ts`.
 */
function newId(): string {
  return uuid();
}

/**
 * The ledger store.
 *
 * Offline-first on purpose: this is the source of truth on the device, and it
 * is fully functional with no account and no network. Cloud sync, when it is
 * configured, pushes from here — it is never required for the app to work,
 * which matters for a finance app people open in a shop with bad signal.
 *
 * Note that no derived figure is stored. Balances, the card position and the
 * safe spend limit are always recomputed from the ledger by `src/domain`, so
 * they can never drift out of sync with the transactions behind them.
 */
export const useLedger = create<LedgerStore>()(
  persist(
    (set, get) => ({
      ledger: emptyLedger(uuid),
      settings: { ...DEFAULT_SETTINGS },
      hydrated: false,

      setLang: (lang) => set((s) => ({ settings: { ...s.settings, lang } })),
      setTheme: (theme) => set((s) => ({ settings: { ...s.settings, theme } })),
      setFxRate: (fxRate) =>
        set((s) => ({ settings: { ...s.settings, fxRate: fxRate > 0 ? fxRate : s.settings.fxRate } })),
      setBiometricLock: (biometricLock) => set((s) => ({ settings: { ...s.settings, biometricLock } })),
      setReminders: (patch) =>
        set((s) => ({ settings: { ...s.settings, reminders: { ...s.settings.reminders, ...patch } } })),

      completeOnboarding: (init) =>
        set((s) => ({
          ledger: { ...s.ledger, ...init },
          settings: { ...s.settings, onboarded: true },
        })),

      addTx: (tx) =>
        set((s) => ({
          // Newest first: every screen that shows transactions wants that order,
          // and sorting at render time would repeat the work on every frame.
          ledger: { ...s.ledger, tx: [{ ...tx, id: newId() }, ...s.ledger.tx] },
        })),

      removeTx: (id) =>
        set((s) => ({ ledger: { ...s.ledger, tx: s.ledger.tx.filter((t) => t.id !== id) } })),

      spend: ({ amt, cat, acct = 'card', memo }) => {
        const type: TxType = 'expense';
        get().addTx({ ts: Date.now(), type, cat: cat ?? null, acct, amt, m: memo, mEn: memo });
      },

      setBase: (base) => set((s) => ({ ledger: { ...s.ledger, base } })),
      setBankOpen: (bankOpen) => set((s) => ({ ledger: { ...s.ledger, bankOpen } })),
      setCashOpen: (cashOpen) => set((s) => ({ ledger: { ...s.ledger, cashOpen } })),

      addCommitment: (c) =>
        set((s) => ({ ledger: { ...s.ledger, commits: [...s.ledger.commits, { ...c, id: newId() }] } })),
      updateCommitment: (id, patch) =>
        set((s) => ({
          ledger: {
            ...s.ledger,
            commits: s.ledger.commits.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          },
        })),
      removeCommitment: (id) =>
        set((s) => ({ ledger: { ...s.ledger, commits: s.ledger.commits.filter((c) => c.id !== id) } })),

      addGoal: (g) =>
        set((s) => ({ ledger: { ...s.ledger, goals: [...s.ledger.goals, { ...g, id: newId() }] } })),
      updateGoal: (id, patch) =>
        set((s) => ({
          ledger: { ...s.ledger, goals: s.ledger.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) },
        })),
      removeGoal: (id) =>
        set((s) => ({ ledger: { ...s.ledger, goals: s.ledger.goals.filter((g) => g.id !== id) } })),

      addPerson: (p) =>
        set((s) => ({ ledger: { ...s.ledger, people: [...s.ledger.people, { ...p, id: newId() }] } })),
      updatePerson: (id, patch) =>
        set((s) => ({
          ledger: { ...s.ledger, people: s.ledger.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) },
        })),
      removePerson: (id) =>
        set((s) => ({ ledger: { ...s.ledger, people: s.ledger.people.filter((p) => p.id !== id) } })),

      // ---- receivables ----------------------------------------------------
      addReceivable: (r) =>
        set((s) => ({ ledger: { ...s.ledger, recv: [...s.ledger.recv, { ...r, id: newId() }] } })),
      updateReceivable: (id, patch) =>
        set((s) => ({
          ledger: { ...s.ledger, recv: s.ledger.recv.map((r) => (r.id === id ? { ...r, ...patch } : r)) },
        })),
      removeReceivable: (id) =>
        set((s) => ({ ledger: { ...s.ledger, recv: s.ledger.recv.filter((r) => r.id !== id) } })),

      receiveReceivable: (id, actual, acct) => {
        const r = get().ledger.recv.find((x) => x.id === id);
        if (!r) return;
        // Expected money only enters the balance once it has actually arrived,
        // and at the amount that actually arrived — not the estimate.
        get().addTx({
          ts: Date.now(),
          type: 'income',
          acct,
          amt: actual,
          m: r.ar,
          mEn: r.en,
        });
        get().updateReceivable(id, { status: 'received', actual });
      },

      // ---- transfers ------------------------------------------------------
      addPlannedTransfer: (t) =>
        set((s) => ({ ledger: { ...s.ledger, planTf: [...s.ledger.planTf, { ...t, id: newId() }] } })),
      removePlannedTransfer: (id) =>
        set((s) => ({ ledger: { ...s.ledger, planTf: s.ledger.planTf.filter((t) => t.id !== id) } })),

      sendTransfer: ({ amt, purpose, memo, goalId, egp }) => {
        get().addTx({
          ts: Date.now(),
          type: 'remit',
          amt,
          m: memo,
          mEn: memo,
          purpose: purpose ?? 'other',
        });
        // A transfer earmarked for a goal also credits that goal, in the goal's
        // own currency — otherwise the money would leave the bank and vanish
        // from the plan entirely.
        if (goalId) {
          const g = get().ledger.goals.find((x) => x.id === goalId);
          if (g) {
            const egpGoal = g.currency ? g.currency === 'EGP' : g.id === 'egypt';
            get().updateGoal(goalId,
              egpGoal && egp != null
                ? { extEgp: (g.extEgp ?? 0) + egp }
                : { alloc: g.alloc + amt },
            );
          }
        }
      },

      // ---- overtime -------------------------------------------------------
      addOvertime: (e) =>
        set((s) => ({ ledger: { ...s.ledger, otEntries: [...s.ledger.otEntries, { ...e, id: newId() }] } })),
      removeOvertime: (id) =>
        set((s) => ({ ledger: { ...s.ledger, otEntries: s.ledger.otEntries.filter((e) => e.id !== id) } })),

      // ---- card -----------------------------------------------------------
      setCardSetup: (cardSetup) => set((s) => ({ ledger: { ...s.ledger, cardSetup } })),
      setCardConfig: (cfg) =>
        set((s) => ({ ledger: { ...s.ledger, cardCfg: { ...s.ledger.cardCfg, ...cfg } } })),

      reconcileCard: (delta, reason) =>
        set((s) => ({
          ledger: {
            ...s.ledger,
            cardAdj: s.ledger.cardAdj + delta,
            cardAdjNote: reason.trim() || s.ledger.cardAdjNote || null,
          },
        })),

      payCard: (amt, acct) => {
        get().addTx({ ts: Date.now(), type: 'ccpay', acct, amt, m: 'سداد البطاقة', mEn: 'Card payment' });
      },

      // ---- salary ---------------------------------------------------------
      setSalaryStatus: (salStatus, salActual) =>
        set((s) => ({
          ledger: { ...s.ledger, salStatus, salActual: salActual ?? s.ledger.salActual },
        })),
      setSavingsTarget: (savTarget) => set((s) => ({ ledger: { ...s.ledger, savTarget } })),

      setMinDailySpend: (minDailySpend) =>
        set((s) => ({
          ledger: {
            ...s.ledger,
            minDailySpend: minDailySpend != null && minDailySpend > 0 ? minDailySpend : null,
          },
        })),

      setGoalMode: (goalId, mode) =>
        set((s) => ({
          ledger: { ...s.ledger, goalMode: { ...(s.ledger.goalMode ?? {}), [goalId]: mode } },
        })),

      startFromToday: (snap) =>
        set((s) => ({
          ledger: {
            ...s.ledger,
            bankOpen: snap.bank,
            cashOpen: snap.cash,
            cardSetup: {
              stmt0: snap.cardStatement,
              unbilled0: snap.cardUnbilled,
              instBal: snap.instBal,
              instMo: snap.instMo,
            },
            cardAdj: 0,
            // History is kept for analytics but stops moving balances: the
            // figures above already include everything that came before.
            tx: s.ledger.tx.map((x) => ({ ...x, post: false })),
            baseline: { ts: Date.now(), cycleSpentBefore: snap.spentThisCycle },
            lastRecStr: new Date().toISOString().slice(0, 10),
          },
        })),

      // ---- categories -----------------------------------------------------
      addCategory: (ar, en) =>
        set((s) => ({
          ledger: { ...s.ledger, cats: [...s.ledger.cats, { id: newId(), ar, en: en || ar }] },
        })),
      removeCategory: (id) =>
        set((s) => {
          const budgets = { ...s.ledger.budgets };
          delete budgets[id];
          return {
            ledger: {
              ...s.ledger,
              cats: s.ledger.cats.filter((c) => c.id !== id),
              budgets,
              // Spending history outlives its category: the entries stay, they
              // just lose the label. Deleting them would silently rewrite the
              // month's totals.
              tx: s.ledger.tx.map((x) => (x.cat === id ? { ...x, cat: null } : x)),
            },
          };
        }),

      // ---- people ---------------------------------------------------------
      settlePerson: (id, amt, acct) => {
        const person = get().ledger.people.find((p) => p.id === id);
        if (!person) return;
        // Paying someone you owe is money out; being repaid is money in.
        get().addTx({
          ts: Date.now(),
          type: person.dir === 'owe' ? 'debtpay' : 'income',
          acct,
          amt,
          m: `${person.dir === 'owe' ? 'سداد' : 'استلام من'} — ${person.name}`,
          mEn: `${person.dir === 'owe' ? 'Payment' : 'Received from'} — ${person.name}`,
          personId: id,
        });
        get().updatePerson(id, { out: Math.max(0, person.out - amt) });
      },

      setBudget: (catId, amount) =>
        set((s) => {
          const budgets = { ...s.ledger.budgets };
          // Removing the key is not the same as storing zero: zero is a real
          // budget of nothing, absent means "not budgeted".
          if (amount == null) delete budgets[catId];
          else budgets[catId] = amount;
          return { ledger: { ...s.ledger, budgets } };
        }),

      learnRule: (merchant, catId) =>
        set((s) => ({
          ledger: { ...s.ledger, rules: { ...s.ledger.rules, [merchant.trim().toLowerCase()]: catId } },
        })),

      reset: () => set({ ledger: emptyLedger(uuid), settings: { ...DEFAULT_SETTINGS } }),

      replaceAll: (ledger, settings) =>
        set((s) => ({ ledger, settings: { ...s.settings, ...settings } })),
    }),
    {
      name: 'masari.ledger.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ ledger: s.ledger, settings: s.settings }),
      /**
       * Zustand's default merge is shallow, so a ledger saved by an older
       * build would replace `settings` wholesale and drop any key added since
       * — leaving, say, `settings.reminders` undefined and crashing on first
       * read. Filling from the defaults per level keeps old saves loadable as
       * the shape grows.
       */
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<LedgerStore>;
        return {
          ...current,
          ...saved,
          ledger: { ...current.ledger, ...(saved.ledger ?? {}) },
          settings: {
            ...current.settings,
            ...(saved.settings ?? {}),
            reminders: {
              ...current.settings.reminders,
              ...(saved.settings?.reminders ?? {}),
            },
          },
        };
      },
      // Runs after the persisted state has been read back. Flipping `hydrated`
      // only here lets the UI hold a splash rather than flashing an empty
      // ledger over the user's real data for a frame. Safe to reference
      // `useLedger` from inside its own initializer because this callback fires
      // asynchronously, long after the binding is assigned.
      onRehydrateStorage: () => () => {
        useLedger.setState({ hydrated: true });
      },
    },
  ),
);
