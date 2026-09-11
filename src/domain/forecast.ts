import type { Ledger } from './types';

/**
 * Month-by-month cash forecast.
 *
 * Every other figure in this app answers "what about today". This answers the
 * question people actually lie awake on: what will I have when the next salary
 * lands, and the one after that, and where does this end up.
 *
 * It is deliberately arithmetic rather than prophecy. Salary in, obligations
 * out, living out, goal set aside — the same four movements repeated, with the
 * closing balance of each month opening the next. No trend fitting, no
 * smoothing: everything it projects is something the user can check by hand,
 * which is the only reason a forecast is worth showing at all.
 */

export interface ForecastMonth {
  /** 0-indexed month and the year it falls in. */
  month: number;
  year: number;
  /** Balance carried in from the previous month. */
  opening: number;
  /** Salary landing at the start of it. */
  salary: number;
  /** Commitments leaving it. */
  commitments: number;
  /** Planned transfers leaving it. */
  transfers: number;
  /** Card settlement leaving it. */
  card: number;
  /** Set aside toward goals. */
  goal: number;
  /** Ordinary living spend. */
  living: number;
  /** What remains at the end of the month. */
  closing: number;
  /** Cumulative amount set aside toward goals by the end of it. */
  savedToDate: number;
}

export interface ForecastInputs {
  /** Balance right now. */
  openingBalance: number;
  salary: number;
  commitments: number;
  transfers: number;
  /** Card settlement expected in the FIRST month only. */
  cardFirstMonth: number;
  /** Card settlement expected in every month after. */
  cardOngoing: number;
  goal: number;
  /** Living spend per month. */
  living: number;
  /**
   * Obligations still to leave THIS month, rather than a whole month's worth —
   * the current month is already part-spent, so charging it in full would
   * understate the balance at the very point the user is checking.
   */
  remainingThisMonth: {
    commitments: number;
    transfers: number;
    living: number;
  };
}

export function forecast(inp: ForecastInputs, months: number, now: Date = new Date()): ForecastMonth[] {
  const out: ForecastMonth[] = [];
  let balance = inp.openingBalance;
  let saved = 0;

  for (let i = 0; i < Math.max(0, months); i++) {
    const first = i === 0;
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);

    /*
     * The current month is entered part-way through: the salary has already
     * landed and some obligations have already been met, so only what REMAINS
     * is charged against it. Every later month is a full cycle.
     */
    const salary = first ? 0 : inp.salary;
    const commitments = first ? inp.remainingThisMonth.commitments : inp.commitments;
    const transfers = first ? inp.remainingThisMonth.transfers : inp.transfers;
    const living = first ? inp.remainingThisMonth.living : inp.living;
    const card = first ? inp.cardFirstMonth : inp.cardOngoing;
    const goal = inp.goal;

    const opening = balance;
    const closing = opening + salary - commitments - transfers - card - goal - living;
    saved += goal;
    balance = closing;

    out.push({
      month: d.getMonth(),
      year: d.getFullYear(),
      opening,
      salary,
      commitments,
      transfers,
      card,
      goal,
      living,
      closing,
      savedToDate: saved,
    });
  }

  return out;
}

/** Builds the inputs from a ledger and its computed position. */
export function forecastFromLedger(
  ledger: Pick<Ledger, 'base'>,
  position: {
    bank: number;
    cash: number | null;
    commitObl: number;
    planT: number;
    cardDue: number;
    cardNextBill: number;
    goalReq: number;
    livingPool: number;
    cycleSpend: number;
    daysLeft: number;
    daysInMonth: number;
  },
  plannedCommitments: number,
  plannedTransfers: number,
): ForecastInputs {
  const livingMonthly = Math.max(0, position.livingPool);
  // What is left of this month's living allowance, not the whole of it.
  const livingLeft = Math.max(0, livingMonthly - position.cycleSpend);

  return {
    openingBalance: position.bank + (position.cash ?? 0),
    salary: ledger.base,
    commitments: plannedCommitments,
    transfers: plannedTransfers,
    cardFirstMonth: position.cardDue,
    cardOngoing: position.cardNextBill,
    goal: position.goalReq,
    living: livingMonthly,
    remainingThisMonth: {
      commitments: position.commitObl,
      transfers: position.planT,
      living: livingLeft,
    },
  };
}
