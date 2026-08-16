import { emptyLedger } from './defaults';
import type {
  Account,
  Category,
  Commitment,
  Goal,
  Ledger,
  OvertimeEntry,
  Person,
  Receivable,
  Tx,
  TxType,
} from './types';

/**
 * Importer for backups written by the original PWA.
 *
 * The old format was the app's entire React state serialised verbatim — UI
 * flags, draft form fields and all — so this deliberately reads only the parts
 * that are actually ledger data and ignores the rest. It is defensive
 * throughout: a backup is the user's only copy of their financial history, and
 * refusing to import because one unexpected field appeared would be the worst
 * possible failure mode.
 *
 * Ids are preserved rather than regenerated so a re-import is idempotent and
 * does not duplicate a year of transactions.
 */

export interface ImportResult {
  ledger: Ledger;
  settings: { lang: 'ar' | 'en'; theme: 'light' | 'dark'; fxRate: number };
  /** Human-readable notes about anything adjusted or dropped. */
  warnings: string[];
  counts: {
    transactions: number;
    categories: number;
    commitments: number;
    people: number;
    goals: number;
    receivables: number;
    overtime: number;
  };
}

const TX_TYPES = new Set<TxType>([
  'income', 'expense', 'ccpay', 'debtpay', 'remit',
  'wd', 'dep', 'adjust', 'lend', 'borrow', 'cardadj',
]);
const ACCOUNTS = new Set<Account>(['bank', 'cash', 'card']);

function num(v: unknown, fallback: number | null = null): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Accepts the raw parsed JSON of a backup file, in either wrapper shape. */
export function importBackup(raw: unknown): ImportResult {
  const warnings: string[] = [];
  const root = (raw ?? {}) as Record<string, unknown>;
  // Backups were written as `{ __v, savedAt, data }`, but some older ones are
  // the bare state object.
  const d = (root.data ?? root) as Record<string, unknown>;

  const led = emptyLedger();

  // ---- accounts -----------------------------------------------------------
  led.bankOpen = num(d.bankOpen, 0) ?? 0;
  led.cashOpen = d.cashOpen == null ? null : num(d.cashOpen, 0);
  led.lastRecStr = typeof d.lastRecStr === 'string' ? d.lastRecStr : null;
  led.base = num(d.base, 0) ?? 0;
  led.salStatus = d.salStatus === 'received' ? 'received' : 'expected';
  led.salActual = num(d.salActual);
  led.savTarget = num(d.savTarget);

  // ---- card ---------------------------------------------------------------
  const cfg = (d.cardCfg ?? {}) as Record<string, unknown>;
  led.cardCfg = {
    limit: num(cfg.limit, 0) ?? 0,
    // Clamped to 1–28 to match the day picker; a statement day of 31 would
    // silently skip February.
    closeDay: Math.min(28, Math.max(1, num(cfg.closeDay, 1) ?? 1)),
    dueDay: Math.min(28, Math.max(1, num(cfg.dueDay, 25) ?? 25)),
  };
  if (d.cardSetup && typeof d.cardSetup === 'object') {
    const cs = d.cardSetup as Record<string, unknown>;
    led.cardSetup = {
      stmt0: num(cs.stmt0, 0) ?? 0,
      unbilled0: num(cs.unbilled0, 0) ?? 0,
      instBal: num(cs.instBal, 0) ?? 0,
      instMo: num(cs.instMo, 0) ?? 0,
    };
  }
  led.cardAdj = num(d.cardAdj, 0) ?? 0;

  // ---- categories ---------------------------------------------------------
  const cats: Category[] = [];
  if (Array.isArray(d.cats)) {
    for (const raw of d.cats) {
      const c = raw as Record<string, unknown>;
      const id = str(c.id);
      if (!id) continue;
      cats.push({ id, ar: str(c.ar, str(c.en)), en: str(c.en, str(c.ar)) });
    }
  }
  if (cats.length) led.cats = cats;

  // ---- budgets ------------------------------------------------------------
  if (d.budgets && typeof d.budgets === 'object') {
    for (const [k, v] of Object.entries(d.budgets as Record<string, unknown>)) {
      const n = num(v);
      if (n != null) led.budgets[k] = n;
    }
  }

  // ---- commitments --------------------------------------------------------
  if (Array.isArray(d.commits)) {
    const out: Commitment[] = [];
    for (const raw of d.commits) {
      const k = raw as Record<string, unknown>;
      const id = str(k.id);
      if (!id) continue;
      out.push({
        id,
        ar: str(k.ar, str(k.en)),
        en: str(k.en, str(k.ar)),
        amt: num(k.amt),
        day: num(k.day),
        paused: bool(k.paused),
        paidMonth: bool(k.paidMonth),
      });
    }
    led.commits = out;
  }

  // ---- people -------------------------------------------------------------
  if (Array.isArray(d.people)) {
    const out: Person[] = [];
    for (const raw of d.people) {
      const p = raw as Record<string, unknown>;
      const id = str(p.id);
      if (!id) continue;
      out.push({
        id,
        name: str(p.name),
        dir: p.dir === 'owe' ? 'owe' : 'owed',
        amt: num(p.amt, 0) ?? 0,
        out: num(p.out, 0) ?? 0,
        fromAcct: ACCOUNTS.has(p.fromAcct as Account) ? (p.fromAcct as Account) : undefined,
      });
    }
    led.people = out;
  }

  // ---- receivables --------------------------------------------------------
  if (Array.isArray(d.recv)) {
    const out: Receivable[] = [];
    for (const raw of d.recv) {
      const r = raw as Record<string, unknown>;
      const id = str(r.id);
      if (!id) continue;
      out.push({
        id,
        ar: str(r.ar, str(r.en)),
        en: str(r.en, str(r.ar)),
        amt: num(r.amt, 0) ?? 0,
        exact: bool(r.exact, true),
        status: r.status === 'received' ? 'received' : 'expected',
        actual: num(r.actual),
      });
    }
    led.recv = out;
  }

  // ---- goals --------------------------------------------------------------
  if (Array.isArray(d.goals)) {
    const out: Goal[] = [];
    for (const raw of d.goals) {
      const g = raw as Record<string, unknown>;
      const id = str(g.id);
      if (!id) continue;
      // The old format carried no goal names, only ids. Give the two known
      // ones proper labels so they do not render as raw identifiers.
      const known: Record<string, { ar: string; en: string }> = {
        egypt: { ar: 'هدف مصر', en: 'Egypt goal' },
        emg: { ar: 'احتياطي الطوارئ', en: 'Emergency fund' },
      };
      const label = known[id] ?? { ar: id, en: id };
      out.push({
        id,
        ar: label.ar,
        en: label.en,
        currency: id === 'egypt' ? 'EGP' : 'AED',
        target: num(g.target),
        alloc: num(g.alloc, 0) ?? 0,
        months: num(g.months),
        extEgp: num(g.extEgp, 0) ?? 0,
        auto: bool(g.auto),
      });
    }
    led.goals = out;
  }

  // ---- planned transfers --------------------------------------------------
  if (Array.isArray(d.planTf)) {
    led.planTf = d.planTf
      .map((raw) => {
        const p = raw as Record<string, unknown>;
        return { id: str(p.id), amt: num(p.amt, 0) ?? 0, day: num(p.day) };
      })
      .filter((p) => p.id !== '');
  }

  // ---- overtime -----------------------------------------------------------
  if (Array.isArray(d.otEntries)) {
    const out: OvertimeEntry[] = [];
    for (const raw of d.otEntries) {
      const e = raw as Record<string, unknown>;
      const id = str(e.id);
      const h = num(e.h);
      const rate = num(e.rate);
      if (!id || h == null || rate == null) continue;
      out.push({ id, h, rate, mult: num(e.mult, 1) ?? 1, date: str(e.date) });
    }
    led.otEntries = out;
  }

  // ---- transactions -------------------------------------------------------
  let droppedTx = 0;
  if (Array.isArray(d.tx)) {
    const out: Tx[] = [];
    for (const raw of d.tx) {
      const x = raw as Record<string, unknown>;
      const id = str(x.id);
      const ts = num(x.ts);
      const amt = num(x.amt);
      const type = x.type as TxType;
      if (!id || ts == null || amt == null || !TX_TYPES.has(type)) {
        droppedTx++;
        continue;
      }
      out.push({
        id,
        ts,
        type,
        cat: typeof x.cat === 'string' ? x.cat : null,
        acct: ACCOUNTS.has(x.acct as Account) ? (x.acct as Account) : undefined,
        amt,
        m: typeof x.m === 'string' ? x.m : undefined,
        mEn: typeof x.mEn === 'string' ? x.mEn : undefined,
        // Only an explicit `false` means non-posting; anything else posts.
        post: x.post === false ? false : true,
        personId: typeof x.personId === 'string' ? x.personId : undefined,
        purpose: typeof x.purpose === 'string' ? x.purpose : undefined,
      });
    }
    // Newest first, matching what every screen expects.
    out.sort((a, b) => b.ts - a.ts);
    led.tx = out;
  }
  if (droppedTx > 0) warnings.push(`skipped-tx:${droppedTx}`);

  // ---- merchant rules -----------------------------------------------------
  if (d.rules && typeof d.rules === 'object') {
    for (const [k, v] of Object.entries(d.rules as Record<string, unknown>)) {
      if (typeof v === 'string') led.rules[k] = v;
    }
  }

  // ---- referential integrity ---------------------------------------------
  // A transaction pointing at a category that no longer exists would render as
  // an em dash forever; clearing it is honest and keeps the amount intact.
  const catIds = new Set(led.cats.map((c) => c.id));
  let orphaned = 0;
  led.tx = led.tx.map((x) => {
    if (x.cat && !catIds.has(x.cat)) {
      orphaned++;
      return { ...x, cat: null };
    }
    return x;
  });
  if (orphaned > 0) warnings.push(`orphaned-category:${orphaned}`);

  const fxRate = num((d.tf as Record<string, unknown> | undefined)?.rate, 13.6) ?? 13.6;

  return {
    ledger: led,
    settings: {
      lang: d.lang === 'en' ? 'en' : 'ar',
      theme: d.theme === 'dark' ? 'dark' : 'light',
      fxRate: fxRate > 0 ? fxRate : 13.6,
    },
    warnings,
    counts: {
      transactions: led.tx.length,
      categories: led.cats.length,
      commitments: led.commits.length,
      people: led.people.length,
      goals: led.goals.length,
      receivables: led.recv.length,
      overtime: led.otEntries.length,
    },
  };
}

/** Parses backup text, returning null when it is not valid JSON. */
export function parseBackup(text: string): ImportResult | null {
  try {
    return importBackup(JSON.parse(text));
  } catch {
    return null;
  }
}
