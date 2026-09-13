import type { SupabaseClient } from '@supabase/supabase-js';
import type { Category, Commitment, Goal, Ledger, Person, Tx } from '../domain';
import { isUuid } from './id';
import { supabase } from './supabase';

/**
 * Ledger sync.
 *
 * Deliberately simple: the device is the source of truth and each sync mirrors
 * it upward. Rows are upserted by their local UUID and anything no longer
 * present locally is deleted, which makes a push idempotent — running it twice
 * leaves the same state.
 *
 * This is last-write-wins, not a merge. For a personal finance app used by one
 * person, usually on one phone, a real CRDT would be a lot of machinery to
 * defend against a conflict that rarely happens; the honest tradeoff is that
 * editing on two devices while offline means the later push wins. `pull`
 * therefore asks before overwriting local state.
 *
 * Rows whose ids are not UUIDs are skipped rather than sent — Postgres would
 * reject them, and failing the whole sync over one legacy row would be worse
 * than syncing the rest.
 */

export interface SyncResult {
  ok: boolean;
  error?: string;
  /** Rows skipped because their id predates UUID ids. */
  skipped?: number;
}

function client(): SupabaseClient | null {
  return supabase;
}

/** Strips rows that cannot be represented remotely, reporting how many. */
function syncable<T extends { id: string }>(rows: T[]): { rows: T[]; skipped: number } {
  const ok = rows.filter((r) => isUuid(r.id));
  return { rows: ok, skipped: rows.length - ok.length };
}

export async function pushLedger(
  ledger: Ledger,
  settings: { lang: string; theme: string; fxRate: number; onboarded: boolean },
): Promise<SyncResult> {
  const sb = client();
  if (!sb) return { ok: false, error: 'not-configured' };

  const { data: auth } = await sb.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return { ok: false, error: 'not-signed-in' };

  let skipped = 0;

  try {
    // ---- profile + scalar ledger fields -----------------------------------
    const { error: pErr } = await sb.from('profiles').upsert({
      user_id: userId,
      lang: settings.lang,
      theme: settings.theme,
      fx_rate: settings.fxRate,
      onboarded: settings.onboarded,
    });
    if (pErr) throw pErr;

    const setup = ledger.cardSetup ?? {};
    const { error: lErr } = await sb.from('ledgers').upsert({
      user_id: userId,
      bank_open: ledger.bankOpen,
      cash_open: ledger.cashOpen,
      last_rec_str: ledger.lastRecStr,
      base_salary: ledger.base,
      sal_status: ledger.salStatus,
      sal_actual: ledger.salActual,
      card_limit: ledger.cardCfg.limit,
      card_close_day: ledger.cardCfg.closeDay,
      card_due_day: ledger.cardCfg.dueDay,
      card_stmt0: setup.stmt0 ?? null,
      card_unbilled0: setup.unbilled0 ?? null,
      card_inst_bal: setup.instBal ?? null,
      card_inst_mo: setup.instMo ?? null,
      card_adj: ledger.cardAdj,
      // Stamps the installment schedule's start; without it the plan balance
      // cannot amortise and stays frozen at its opening figure.
      card_setup_at: setup.setupAt != null ? new Date(setup.setupAt).toISOString() : null,
      sav_target: ledger.savTarget,
      ssl_basis: ledger.sslBasis ?? 'salary',
    });
    if (lErr) throw lErr;

    // ---- collections ------------------------------------------------------
    const cats = syncable(ledger.cats);
    skipped += cats.skipped;
    await replaceCollection(sb, 'categories', userId, cats.rows, (c: Category, i) => ({
      id: c.id,
      user_id: userId,
      name_ar: c.ar,
      name_en: c.en,
      budget: ledger.budgets[c.id] ?? null,
      sort_order: i,
    }));

    const txs = syncable(ledger.tx);
    skipped += txs.skipped;
    await replaceCollection(sb, 'transactions', userId, txs.rows, (x: Tx) => ({
      id: x.id,
      user_id: userId,
      occurred_at: new Date(x.ts).toISOString(),
      type: x.type,
      // Only send a category reference that will actually resolve, or the
      // foreign key rejects the row.
      category_id: x.cat && isUuid(x.cat) ? x.cat : null,
      account: x.acct ?? null,
      amount: x.amt,
      memo_ar: x.m ?? null,
      memo_en: x.mEn ?? null,
      posts: x.post !== false,
      person_id: x.personId && isUuid(x.personId) ? x.personId : null,
      purpose: x.purpose ?? null,
    }));

    const commits = syncable(ledger.commits);
    skipped += commits.skipped;
    await replaceCollection(sb, 'commitments', userId, commits.rows, (k: Commitment) => ({
      id: k.id,
      user_id: userId,
      name_ar: k.ar,
      name_en: k.en,
      amount: k.amt,
      due_day: k.day,
      paused: k.paused,
      paid_month: k.paidMonth,
      paid_for: k.paidFor ?? null,
    }));

    const people = syncable(ledger.people);
    skipped += people.skipped;
    await replaceCollection(sb, 'people', userId, people.rows, (p: Person) => ({
      id: p.id,
      user_id: userId,
      name: p.name,
      direction: p.dir,
      principal: p.amt,
      outstanding: p.out,
      from_account: p.fromAcct ?? null,
    }));

    const goals = syncable(ledger.goals);
    skipped += goals.skipped;
    await replaceCollection(sb, 'goals', userId, goals.rows, (g: Goal) => ({
      id: g.id,
      user_id: userId,
      name_ar: g.ar,
      name_en: g.en,
      currency: g.currency ?? (g.id === 'egypt' ? 'EGP' : 'AED'),
      target: g.target,
      allocated: g.alloc,
      months: g.months,
      external_egp: g.extEgp ?? 0,
      auto: g.auto,
    }));

    return { ok: true, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), skipped };
  }
}

/**
 * Upserts every row, then deletes the user's rows that are no longer present.
 * The delete runs second so a failure mid-way leaves extra rows rather than
 * missing ones — losing a transaction is far worse than keeping a stale one.
 */
async function replaceCollection<T extends { id: string }>(
  sb: SupabaseClient,
  table: string,
  userId: string,
  rows: T[],
  map: (row: T, index: number) => Record<string, unknown>,
): Promise<void> {
  if (rows.length > 0) {
    const { error } = await sb.from(table).upsert(rows.map(map));
    if (error) throw error;
  }

  const keep = rows.map((r) => r.id);
  const query = sb.from(table).delete().eq('user_id', userId);
  const { error: dErr } = keep.length
    ? await query.not('id', 'in', `(${keep.join(',')})`)
    : await query;
  if (dErr) throw dErr;
}

export interface PulledLedger {
  ledger: Ledger;
  settings: { lang: 'ar' | 'en'; theme: 'light' | 'dark'; fxRate: number; onboarded: boolean };
}

/**
 * Reads the remote ledger back.
 *
 * Returns `null` when the account has never synced, so the caller can tell
 * "nothing stored yet" apart from "stored, and it is empty" — overwriting a
 * populated phone with a genuinely empty remote is the one destructive case
 * here, and the UI confirms before doing it.
 */
export async function pullLedger(): Promise<{ result: PulledLedger | null; error?: string }> {
  const sb = client();
  if (!sb) return { result: null, error: 'not-configured' };

  const { data: auth } = await sb.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return { result: null, error: 'not-signed-in' };

  try {
    const [profile, led, cats, txs, commits, people, goals] = await Promise.all([
      sb.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      sb.from('ledgers').select('*').eq('user_id', userId).maybeSingle(),
      sb.from('categories').select('*').eq('user_id', userId).order('sort_order'),
      sb.from('transactions').select('*').eq('user_id', userId).order('occurred_at', { ascending: false }),
      sb.from('commitments').select('*').eq('user_id', userId),
      sb.from('people').select('*').eq('user_id', userId),
      sb.from('goals').select('*').eq('user_id', userId),
    ]);

    for (const r of [profile, led, cats, txs, commits, people, goals]) {
      if (r.error) throw r.error;
    }
    if (!led.data) return { result: null };

    const l = led.data as Record<string, unknown>;
    const num = (v: unknown, fallback = 0) => (v == null ? fallback : Number(v));

    const budgets: Record<string, number> = {};
    const categories: Category[] = (cats.data ?? []).map((c: Record<string, unknown>) => {
      if (c.budget != null) budgets[String(c.id)] = Number(c.budget);
      return { id: String(c.id), ar: String(c.name_ar), en: String(c.name_en) };
    });

    const ledger: Ledger = {
      bankOpen: num(l.bank_open),
      cashOpen: l.cash_open == null ? null : Number(l.cash_open),
      lastRecStr: (l.last_rec_str as string | null) ?? null,
      cardCfg: {
        limit: num(l.card_limit),
        closeDay: num(l.card_close_day, 1),
        dueDay: num(l.card_due_day, 25),
      },
      cardSetup:
        l.card_stmt0 == null && l.card_unbilled0 == null
          ? null
          : {
              stmt0: num(l.card_stmt0),
              unbilled0: num(l.card_unbilled0),
              instBal: num(l.card_inst_bal),
              instMo: num(l.card_inst_mo),
              setupAt:
                typeof l.card_setup_at === 'string' ? Date.parse(l.card_setup_at) : null,
            },
      cardAdj: num(l.card_adj),
      base: num(l.base_salary),
      salStatus: (l.sal_status as 'expected' | 'received') ?? 'expected',
      salActual: l.sal_actual == null ? null : Number(l.sal_actual),
      otEntries: [],
      cats: categories,
      budgets,
      commits: (commits.data ?? []).map((k: Record<string, unknown>) => ({
        id: String(k.id),
        ar: String(k.name_ar),
        en: String(k.name_en),
        amt: k.amount == null ? null : Number(k.amount),
        day: k.due_day == null ? null : Number(k.due_day),
        paused: Boolean(k.paused),
        paidMonth: Boolean(k.paid_month),
        paidFor: typeof k.paid_for === 'string' ? k.paid_for : null,
      })),
      people: (people.data ?? []).map((p: Record<string, unknown>) => ({
        id: String(p.id),
        name: String(p.name),
        dir: p.direction === 'owe' ? 'owe' : 'owed',
        amt: num(p.principal),
        out: num(p.outstanding),
        fromAcct: (p.from_account as 'bank' | 'cash' | undefined) ?? undefined,
      })),
      recv: [],
      goals: (goals.data ?? []).map((g: Record<string, unknown>) => ({
        id: String(g.id),
        ar: String(g.name_ar ?? ''),
        en: String(g.name_en ?? ''),
        currency: g.currency === 'EGP' ? 'EGP' : 'AED',
        target: g.target == null ? null : Number(g.target),
        alloc: num(g.allocated),
        months: g.months == null ? null : Number(g.months),
        extEgp: num(g.external_egp),
        auto: Boolean(g.auto),
      })),
      planTf: [],
      tx: (txs.data ?? []).map((x: Record<string, unknown>) => ({
        id: String(x.id),
        ts: new Date(String(x.occurred_at)).getTime(),
        type: x.type as Tx['type'],
        cat: (x.category_id as string | null) ?? null,
        acct: (x.account as Tx['acct']) ?? undefined,
        amt: num(x.amount),
        m: (x.memo_ar as string | null) ?? undefined,
        mEn: (x.memo_en as string | null) ?? undefined,
        post: x.posts !== false,
        personId: (x.person_id as string | null) ?? undefined,
        purpose: (x.purpose as string | null) ?? undefined,
      })),
      rules: {},
      savTarget: l.sav_target == null ? null : Number(l.sav_target),
      sslBasis:
        l.ssl_basis === 'balance' ? 'balance' : l.ssl_basis === 'goal' ? 'goal' : 'salary',
    };

    const prof = (profile.data ?? {}) as Record<string, unknown>;
    return {
      result: {
        ledger,
        settings: {
          lang: prof.lang === 'en' ? 'en' : 'ar',
          theme: prof.theme === 'dark' ? 'dark' : 'light',
          fxRate: prof.fx_rate == null ? 13.6 : Number(prof.fx_rate),
          onboarded: Boolean(prof.onboarded),
        },
      },
    };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : String(e) };
  }
}
