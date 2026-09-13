import type { Commitment } from './types';

/**
 * Commitment scheduling.
 *
 * The prototype treated a commitment as a flat "unpaid → deduct it" flag, which
 * is wrong in two ways that both cost real money.
 *
 * First, `paidMonth` was a bare boolean with no month attached and nothing ever
 * cleared it, despite the type claiming otherwise. Marking the rent paid in
 * August left it marked paid in September, October and every month after —
 * silently removing it from the daily limit forever. `paidFor` stamps the cycle
 * it was paid for, so the flag expires on its own when the cycle turns.
 *
 * Second, every unpaid commitment was deducted regardless of its due date, with
 * no way to tell an overdue one from one falling due next week. Both still have
 * to be paid, so both are still deducted — but they are very different
 * situations, and the app now says which is which and asks about the ambiguous
 * one instead of quietly assuming.
 */

/** 'YYYY-MM' — the cycle a commitment was paid for. */
export function cycleKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export type CommitState =
  /** Switched off; claims nothing. */
  | 'paused'
  /** Marked paid for THIS cycle; claims nothing. */
  | 'paid'
  /** Falls due later this cycle. */
  | 'upcoming'
  /** Due today. */
  | 'today'
  /**
   * Its day passed this cycle and it was never marked paid. Still claimed —
   * an unpaid bill does not stop being owed — but flagged for confirmation,
   * because the far likelier explanation is that it was paid and not ticked.
   */
  | 'overdue'
  /** No amount or no day set; nothing to schedule. */
  | 'incomplete';

export interface CommitStatus {
  commit: Commitment;
  state: CommitState;
  /** The date it falls due in this cycle, when it has a day. */
  due: Date | null;
  /** Days from today until it falls due. Negative once it has passed. */
  daysAway: number | null;
  /** Whether it is deducted from this cycle's salary. */
  claims: boolean;
  /** The amount it claims, zero when it claims nothing. */
  amount: number;
  /** True when the app cannot tell whether this was really paid. */
  needsConfirm: boolean;
}

/** Whether a commitment counts as paid for the cycle containing `now`. */
export function isPaidFor(c: Commitment, now: Date): boolean {
  // `paidFor` is authoritative once present. A legacy `paidMonth` with no
  // stamp is honoured only for the current cycle, so an old save does not
  // suddenly re-charge a bill the user already ticked — but it does expire
  // at the next rollover instead of lasting forever.
  if (c.paidFor != null) return c.paidFor === cycleKey(now);
  return c.paidMonth === true;
}

export function commitmentStatus(c: Commitment, now: Date = new Date()): CommitStatus {
  const amt = c.amt ?? 0;

  if (c.paused) {
    return { commit: c, state: 'paused', due: null, daysAway: null, claims: false, amount: 0, needsConfirm: false };
  }
  if (isPaidFor(c, now)) {
    return { commit: c, state: 'paid', due: null, daysAway: null, claims: false, amount: 0, needsConfirm: false };
  }
  if (amt <= 0 || c.day == null) {
    // Deliberately claims nothing: deducting an unknown amount is not possible,
    // and deducting zero silently would hide that the plan is incomplete.
    return { commit: c, state: 'incomplete', due: null, daysAway: null, claims: false, amount: 0, needsConfirm: false };
  }

  // Clamped so day 31 still lands inside a 30-day month rather than spilling
  // into the next one and reporting a due date in the wrong cycle.
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = Math.min(Math.max(1, c.day), lastDay);
  const due = new Date(now.getFullYear(), now.getMonth(), day);
  const daysAway = day - now.getDate();

  const state: CommitState = daysAway > 0 ? 'upcoming' : daysAway === 0 ? 'today' : 'overdue';

  return {
    commit: c,
    state,
    due,
    daysAway,
    claims: true,
    amount: amt,
    needsConfirm: state === 'overdue',
  };
}

export interface CommitmentsDue {
  items: CommitStatus[];
  /** Total deducted from this cycle's salary. */
  total: number;
  /** Falling due later this cycle. */
  upcoming: number;
  /** Past its date and never ticked — still owed, but worth confirming. */
  overdue: number;
  /** Already settled for this cycle. */
  paid: number;
  /** Set but missing an amount or a date, so nothing could be scheduled. */
  incomplete: number;
  /** How many need the user to confirm whether they were actually paid. */
  needsConfirm: number;
}

/** Every commitment's standing this cycle, and what they claim in total. */
export function commitmentsDue(commits: Commitment[], now: Date = new Date()): CommitmentsDue {
  const items = commits
    .map((c) => commitmentStatus(c, now))
    // Soonest first, overdue ahead of upcoming, settled and inactive last.
    .sort((a, b) => {
      const rank = (s: CommitState) =>
        s === 'overdue' ? 0 : s === 'today' ? 1 : s === 'upcoming' ? 2 : s === 'incomplete' ? 3 : 4;
      const d = rank(a.state) - rank(b.state);
      return d !== 0 ? d : (a.daysAway ?? 99) - (b.daysAway ?? 99);
    });

  const sum = (pred: (x: CommitStatus) => boolean) =>
    items.filter(pred).reduce((a, x) => a + (x.commit.amt ?? 0), 0);

  return {
    items,
    total: items.filter((x) => x.claims).reduce((a, x) => a + x.amount, 0),
    upcoming: sum((x) => x.state === 'upcoming' || x.state === 'today'),
    overdue: sum((x) => x.state === 'overdue'),
    paid: sum((x) => x.state === 'paid'),
    incomplete: items.filter((x) => x.state === 'incomplete').length,
    needsConfirm: items.filter((x) => x.needsConfirm).length,
  };
}
