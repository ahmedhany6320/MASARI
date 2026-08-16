import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { uuid } from '../lib/id';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_FX_RATE,
  emptyLedger,
  type Account,
  type Commitment,
  type Goal,
  type Lang,
  type Ledger,
  type Person,
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
