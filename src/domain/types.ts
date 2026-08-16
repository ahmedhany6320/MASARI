/**
 * Domain types for the Masari ledger.
 *
 * Everything in `src/domain` is pure and platform-free — no React, no React
 * Native, no Expo, no I/O, no `Date.now()`. Callers pass the clock in. That is
 * what makes the money math testable, and it is why this layer can be lifted
 * into a web build or a server later without touching a line.
 *
 * Amounts are in the salary currency (AED) unless a field says otherwise.
 * `Goal.target` for the Egypt goal is the exception: it is denominated in EGP
 * and converted with the FX rate at read time.
 */

export type Lang = 'ar' | 'en';
export type Theme = 'light' | 'dark';

/** Where money physically sits. The credit card is a liability, not a balance. */
export type Account = 'bank' | 'cash' | 'card';

/**
 * Ledger entry kinds. Each one moves the bank/cash balances differently — see
 * `balances.ts`, which is the single authority on those effects.
 *
 * - `income`    money arriving (salary, a repayment received)
 * - `expense`   money spent, on any account including the card
 * - `ccpay`     paying the credit card statement
 * - `debtpay`   repaying a person you owe
 * - `remit`     international transfer out (always from bank)
 * - `wd`        cash withdrawal: bank down, cash up
 * - `dep`       cash deposit: cash down, bank up
 * - `adjust`    reconciliation correction against the bank (signed)
 * - `lend`      money lent to a person
 * - `borrow`    money borrowed from a person
 */
export type TxType =
  | 'income'
  | 'expense'
  | 'ccpay'
  | 'debtpay'
  | 'remit'
  | 'wd'
  | 'dep'
  | 'adjust'
  | 'lend'
  | 'borrow';

export interface Tx {
  id: string;
  /** Epoch milliseconds. */
  ts: number;
  type: TxType;
  /** Category id, for expenses. */
  cat?: string | null;
  /** Arabic memo. */
  m?: string;
  /** English memo. */
  mEn?: string;
  acct?: Account;
  amt: number;
  /**
   * `false` means this entry is already baked into the opening reconciled
   * balance and must NOT be applied again — it exists for history display
   * only. Absent or `true` means it posts. This distinction is load-bearing:
   * treating a non-posting row as posting double-counts the balance.
   */
  post?: boolean;
  /** Set on repayments so the person's outstanding can be traced. */
  personId?: string;
  /** Amount returned, on a repayment received. */
  back?: number;
  /** For `remit`: `goal` transfers are savings, not spending. */
  purpose?: string;
}

export interface Category {
  id: string;
  ar: string;
  en: string;
}

/** A recurring monthly obligation (rent, phone, subscriptions). */
export interface Commitment {
  id: string;
  ar: string;
  en: string;
  amt: number | null;
  /** Day of month it falls due. */
  day: number | null;
  paused: boolean;
  /** Cleared at the start of each cycle. */
  paidMonth: boolean;
}

/** `owe` = you owe them. `owed` = they owe you. */
export type DebtDirection = 'owe' | 'owed';

export interface Person {
  id: string;
  name: string;
  /** Original principal. */
  amt: number;
  /** Still outstanding. */
  out: number;
  dir: DebtDirection;
  fromAcct?: Account;
}

/** Non-person money you are expecting (a reimbursement, a refund). */
export interface Receivable {
  id: string;
  ar: string;
  en: string;
  amt: number;
  /** `false` renders the amount as an approximation. */
  exact: boolean;
  status: 'expected' | 'received';
  actual: number | null;
}

export interface Goal {
  id: string;
  ar: string;
  en: string;
  /**
   * Currency the target is denominated in. The prototype hardcoded this off
   * `id === 'egypt'`; that special case is still honoured when the field is
   * absent so ledgers saved by the prototype keep computing the same numbers.
   */
  currency?: 'EGP' | 'AED';
  /** Denominated in `currency` — EGP for the Egypt goal, otherwise AED. */
  target: number | null;
  /** Already set aside, in the salary currency. */
  alloc: number;
  /** Months remaining to hit the target. `null` means no schedule yet. */
  months: number | null;
  /** Egypt goal only: money already sitting in Egypt, in EGP. */
  extEgp?: number;
  auto: boolean;
}

export interface CardConfig {
  limit: number;
  /** Day of month the statement closes. */
  closeDay: number;
  /** Day of month payment is due. */
  dueDay: number;
}

/**
 * Opening card position, captured once when the user sets the card up. Card
 * activity after setup is derived from the ledger, not stored here.
 */
export interface CardSetup {
  /** Statement balance outstanding at setup. */
  stmt0?: number;
  /** Spending not yet billed at setup. */
  unbilled0?: number;
  /** Installment plan balance. */
  instBal?: number;
  /** Installment charge per month. */
  instMo?: number;
}

export interface OvertimeEntry {
  id: string;
  /** Hours worked. */
  h: number;
  /** Hourly rate. */
  rate: number;
  /** Multiplier (1.25, 1.5, ...). */
  mult: number;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
}

/** A planned (not yet executed) international transfer. */
export interface PlannedTransfer {
  id: string;
  amt: number;
  day: number | null;
}

export type SalaryStatus = 'expected' | 'received';

/**
 * The whole ledger. This is what gets persisted and synced — UI-only state
 * (open sheets, drafts, toasts) is deliberately kept out, so a sync never
 * ships transient interface state to the server.
 */
export interface Ledger {
  /** Reconciled bank balance at the opening date. */
  bankOpen: number;
  /** `null` until the user starts tracking cash at all. */
  cashOpen: number | null;
  lastRecStr: string | null;

  cardCfg: CardConfig;
  cardSetup: CardSetup | null;
  /** Manual correction to the unbilled figure. */
  cardAdj: number;
  /**
   * Why the card was last reconciled. The prototype required a documented
   * reason for any manual override of a calculated figure; keeping it means a
   * surprising card balance can still be explained months later.
   */
  cardAdjNote?: string | null;

  /** Monthly base salary. */
  base: number;
  salStatus: SalaryStatus;
  salActual: number | null;
  otEntries: OvertimeEntry[];

  cats: Category[];
  /** Category id → monthly budget. */
  budgets: Record<string, number>;
  commits: Commitment[];
  people: Person[];
  recv: Receivable[];
  goals: Goal[];
  planTf: PlannedTransfer[];
  tx: Tx[];
  /** Merchant string → category id, learned from confirmations. */
  rules: Record<string, string>;

  savTarget: number | null;
}
