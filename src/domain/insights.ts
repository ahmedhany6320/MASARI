import { isEgpGoal } from './goals';
import type { Goal, Ledger, Tx } from './types';

/**
 * Insights — the analysis layer.
 *
 * Everything here answers a question the raw ledger cannot: where the money
 * actually goes, whether this month is on track, and when a goal will land at
 * the pace the user is genuinely moving at. Pure and clock-injected like the
 * rest of the domain, so all of it is testable.
 *
 * The guiding rule is that an insight must be actionable. "You spent 331 on
 * restaurants" is a fact; "restaurants are 49% of your spending and cutting
 * them a fifth reaches your goal a month sooner" is an insight.
 */

export interface MerchantStat {
  /** Merchant name as the user typed it, normalised for grouping. */
  name: string;
  count: number;
  total: number;
  average: number;
  /** Share of all spending in the window, 0–1. */
  share: number;
  lastSeen: number;
}

export interface CategoryStat {
  id: string | null;
  total: number;
  count: number;
  share: number;
}

export interface WeekdayStat {
  /** 0 = Sunday. */
  weekday: number;
  total: number;
  count: number;
  /** Average per occurrence of that weekday in the window. */
  average: number;
}

/** Expenses only, within the window, excluding non-posting history. */
function expensesSince(ledger: Ledger, since: number): Tx[] {
  return ledger.tx.filter((x) => x.type === 'expense' && x.ts >= since);
}

/** Merchant names are matched case-insensitively and trimmed. */
function merchantKey(x: Tx): string | null {
  const raw = (x.m ?? x.mEn ?? '').trim();
  return raw === '' ? null : raw;
}

/**
 * Spending grouped by merchant, biggest first.
 *
 * This is the single most useful view in a personal finance app: people do not
 * think in categories, they think "I keep going to that one place".
 */
export function merchantStats(ledger: Ledger, since: number, limit = 10): MerchantStat[] {
  const rows = expensesSince(ledger, since);
  const total = rows.reduce((a, x) => a + x.amt, 0);

  const acc = new Map<string, { name: string; count: number; total: number; lastSeen: number }>();
  for (const x of rows) {
    const name = merchantKey(x);
    if (!name) continue;
    const key = name.toLowerCase();
    const cur = acc.get(key) ?? { name, count: 0, total: 0, lastSeen: 0 };
    cur.count += 1;
    cur.total += x.amt;
    cur.lastSeen = Math.max(cur.lastSeen, x.ts);
    acc.set(key, cur);
  }

  return Array.from(acc.values())
    .map((m) => ({
      ...m,
      average: m.total / m.count,
      share: total > 0 ? m.total / total : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function categoryStats(ledger: Ledger, since: number): CategoryStat[] {
  const rows = expensesSince(ledger, since);
  const total = rows.reduce((a, x) => a + x.amt, 0);

  const acc = new Map<string | null, { total: number; count: number }>();
  for (const x of rows) {
    const key = x.cat ?? null;
    const cur = acc.get(key) ?? { total: 0, count: 0 };
    cur.total += x.amt;
    cur.count += 1;
    acc.set(key, cur);
  }

  return Array.from(acc.entries())
    .map(([id, v]) => ({ id, ...v, share: total > 0 ? v.total / total : 0 }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Spending by day of week.
 *
 * Averaged per occurrence rather than summed, because a window that happens to
 * contain three Fridays and two Saturdays would otherwise make Friday look
 * worse than it is.
 */
export function weekdayStats(ledger: Ledger, since: number, now: Date): WeekdayStat[] {
  const rows = expensesSince(ledger, since);

  const occurrences = new Array<number>(7).fill(0);
  for (let d = new Date(since); d <= now; d.setDate(d.getDate() + 1)) {
    const i = d.getDay();
    occurrences[i] = (occurrences[i] ?? 0) + 1;
  }

  const totals = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);
  for (const x of rows) {
    const i = new Date(x.ts).getDay();
    totals[i] = (totals[i] ?? 0) + x.amt;
    counts[i] = (counts[i] ?? 0) + 1;
  }

  return totals.map((total, weekday) => ({
    weekday,
    total,
    count: counts[weekday] ?? 0,
    average: (occurrences[weekday] ?? 0) > 0 ? total / (occurrences[weekday] ?? 1) : 0,
  }));
}

export interface BurnRate {
  /** Days of actual data in the window. */
  days: number;
  total: number;
  /** Average spend per elapsed day. */
  perDay: number;
  /** Distinct days on which anything was spent. */
  activeDays: number;
  /** Projected total for the full month at this pace. */
  projectedMonth: number;
  /** Projected month spend minus the living pool. Positive means overspending. */
  projectedOverrun: number;
}

/**
 * Burn rate for the current month, and where it lands by month end.
 *
 * Divides by days ELAPSED, not by days on which money was spent — a quiet
 * Tuesday is still a day of the budget, and dividing by active days only would
 * flatter the number badly.
 */
export function burnRate(ledger: Ledger, livingPool: number, now: Date): BurnRate {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = Math.max(1, now.getDate());

  const rows = expensesSince(ledger, monthStart);
  const total = rows.reduce((a, x) => a + x.amt, 0);
  const activeDays = new Set(rows.map((x) => new Date(x.ts).toDateString())).size;

  const perDay = total / elapsed;
  const projectedMonth = perDay * daysInMonth;

  return {
    days: elapsed,
    total,
    perDay,
    activeDays,
    projectedMonth,
    projectedOverrun: projectedMonth - livingPool,
  };
}

export interface GoalProjection {
  goalId: string;
  /** Still needed, in the goal's own currency. */
  remaining: number;
  /** What is being saved each month, in the salary currency. */
  monthlySaving: number;
  /** Months to reach the target at the current pace. Null when never. */
  monthsAtCurrentPace: number | null;
  /** Projected arrival date, or null when the pace would never get there. */
  eta: Date | null;
  /** The user's own deadline, when set. */
  targetMonths: number | null;
  /** True when the current pace misses the user's own deadline. */
  behindSchedule: boolean;
}

/**
 * When a goal actually lands at the pace the user is really saving.
 *
 * This exists because a target with no deadline reserves nothing and therefore
 * silently never happens — the prototype simply showed 0 and moved on. Working
 * backwards from observed saving turns a dormant number into a real date, and
 * a zero or negative saving rate honestly reports "never" rather than a
 * comforting fiction.
 */
export function goalProjection(
  goal: Goal,
  monthlySaving: number,
  fxRate: number,
  now: Date,
): GoalProjection {
  const egp = isEgpGoal(goal);
  const held = egp ? goal.alloc * fxRate + (goal.extEgp ?? 0) : goal.alloc;
  const remaining = Math.max(0, (goal.target ?? 0) - held);

  // Compare like with like: convert the monthly saving into the goal's currency.
  const savingInGoalCurrency = egp ? monthlySaving * fxRate : monthlySaving;

  const months =
    remaining <= 0 ? 0 : savingInGoalCurrency > 0 ? remaining / savingInGoalCurrency : null;

  let eta: Date | null = null;
  if (months != null) {
    eta = new Date(now.getFullYear(), now.getMonth() + Math.ceil(months), now.getDate());
  }

  return {
    goalId: goal.id,
    remaining,
    monthlySaving,
    monthsAtCurrentPace: months,
    eta,
    targetMonths: goal.months,
    behindSchedule: goal.months != null && months != null && months > goal.months,
  };
}

export interface RecurringCandidate {
  name: string;
  /** Typical amount. */
  amount: number;
  occurrences: number;
  /** Average gap between charges, in days. */
  intervalDays: number;
  lastSeen: number;
  /** True when the gap looks monthly. */
  monthly: boolean;
}

/**
 * Detects charges that look like subscriptions.
 *
 * Requires at least three occurrences at a steady interval and a stable
 * amount. Two charges is a coincidence, and a wildly varying amount is a shop
 * you visit often, not a subscription — flagging those would train the user to
 * ignore the list.
 */
export function detectRecurring(ledger: Ledger, now: Date, windowDays = 120): RecurringCandidate[] {
  const since = now.getTime() - windowDays * 864e5;
  const rows = expensesSince(ledger, since);

  const groups = new Map<string, Tx[]>();
  for (const x of rows) {
    const name = merchantKey(x);
    if (!name) continue;
    const key = name.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }

  const out: RecurringCandidate[] = [];
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.ts - b.ts);

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((sorted[i]!.ts - sorted[i - 1]!.ts) / 864e5);
    }
    const avgGap = gaps.reduce((a, g) => a + g, 0) / gaps.length;
    if (avgGap < 20) continue; // more often than roughly monthly: not a subscription

    const amounts = sorted.map((x) => x.amt);
    const avgAmt = amounts.reduce((a, v) => a + v, 0) / amounts.length;
    // Amounts must be stable within 15% for this to look like a fixed charge.
    const stable = amounts.every((v) => Math.abs(v - avgAmt) <= avgAmt * 0.15);
    if (!stable) continue;

    out.push({
      name: sorted[0]!.m ?? sorted[0]!.mEn ?? '',
      amount: avgAmt,
      occurrences: sorted.length,
      intervalDays: avgGap,
      lastSeen: sorted[sorted.length - 1]!.ts,
      monthly: avgGap >= 25 && avgGap <= 35,
    });
  }

  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * Consecutive days, counting back from yesterday, that stayed within the daily
 * allowance.
 *
 * Today is excluded on purpose: the day is not over, and counting it would let
 * the streak break and un-break as the day goes on.
 */
export function underLimitStreak(ledger: Ledger, allowance: number, now: Date): number {
  if (allowance <= 0) return 0;

  const byDay = new Map<string, number>();
  for (const x of ledger.tx) {
    if (x.type !== 'expense') continue;
    const key = new Date(x.ts).toDateString();
    byDay.set(key, (byDay.get(key) ?? 0) + x.amt);
  }

  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cursor.setDate(cursor.getDate() - 1);

  // Bounded so a brand-new ledger with no history cannot spin forever.
  for (let i = 0; i < 365; i++) {
    const spent = byDay.get(cursor.toDateString()) ?? 0;
    if (spent > allowance) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface SpendingComparison {
  thisMonth: number;
  lastMonth: number;
  /** Signed change, 0–1 scale. Null when there is no prior month to compare. */
  change: number | null;
  /** Same-day-of-month comparison, so a partial month is judged fairly. */
  lastMonthToDate: number;
}

/**
 * This month against last.
 *
 * Compares like for like by truncating last month at the same day number —
 * comparing 14 days against a full 31 would always look like an improvement.
 */
export function monthComparison(ledger: Ledger, now: Date): SpendingComparison {
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();

  const thisStart = new Date(y, m, 1).getTime();
  const lastStart = new Date(y, m - 1, 1).getTime();
  const lastEnd = new Date(y, m, 1).getTime();
  // Clamped so 31 January compared against February does not overflow.
  const lastMonthDays = new Date(y, m, 0).getDate();
  const lastToDateEnd = new Date(y, m - 1, Math.min(day, lastMonthDays), 23, 59, 59).getTime();

  const sum = (from: number, to: number) =>
    ledger.tx
      .filter((x) => x.type === 'expense' && x.ts >= from && x.ts < to)
      .reduce((a, x) => a + x.amt, 0);

  const thisMonth = sum(thisStart, now.getTime() + 1);
  const lastMonth = sum(lastStart, lastEnd);
  const lastMonthToDate = sum(lastStart, lastToDateEnd);

  return {
    thisMonth,
    lastMonth,
    lastMonthToDate,
    change: lastMonthToDate > 0 ? (thisMonth - lastMonthToDate) / lastMonthToDate : null,
  };
}
