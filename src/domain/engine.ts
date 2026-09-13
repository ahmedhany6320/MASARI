import { forecast, forecastFromLedger, type ForecastMonth } from './forecast';
import { DEFAULT_FX_RATE } from './defaults';
import { goalMonthlyRequirement } from './goals';
import { safeSpend, type SafeSpend } from './safeSpend';
import type { DailyBudget, Feasibility, Projection } from './projection';
import type { Goal, Ledger } from './types';

/**
 * The one way in.
 *
 * Not a rewrite — a front door. `safeSpend` already assembled most of this,
 * but screens also reached past it into `goalPlan`, `adaptive`, `spendPlan`
 * and `forecast` directly, so "where does the goal land" had several callers
 * and several answers. This is the single entry point they migrate onto, and
 * the place the contract in `docs/financial-contract.md` is actually enforced
 * rather than merely described.
 *
 * What it adds beyond forwarding:
 *
 *   - ONE goal identity. Everything below reports on the same goal, named, so
 *     a headline and the detail beneath it cannot describe different ones.
 *   - ONE daily figure and ONE monthly goal contribution, both traceable to
 *     the projection that produced them.
 *   - `consistency`, which re-derives the relationships that must hold and
 *     reports any that do not. The tests assert it is empty; a future change
 *     that makes two engines disagree fails there instead of on a screen.
 */

export interface EngineOptions {
  /** Salary-currency-to-EGP rate. */
  fx?: number;
  /** Months of balance forecast to produce. */
  forecastMonths?: number;
}

/** A relationship that must hold, and did not. */
export interface ConsistencyBreach {
  rule: string;
  detail: string;
  left: number;
  right: number;
}

export interface FinancialState {
  /** When this was evaluated. Every figure below is as of this instant. */
  asOf: Date;

  /** Bank plus cash minus everything owed on the card. */
  netPosition: number;
  bank: number;
  cash: number;
  cardOutstanding: number;

  /** The goal every figure below refers to, or null when none steers. */
  goal: Goal | null;
  feasibility: Feasibility;

  /** What is still safe to spend today. */
  today: number;
  /** The daily figure before today's spending is taken off it. */
  allowance: number;
  /** Spent today so far. */
  spentToday: number;
  /** The derivation behind `today`, when a range is declared. */
  daily: DailyBudget | null;

  /** The month's discretionary budget, which `today` is derived from. */
  monthlyLiving: number;
  /** What the goal receives this month, all sources included. */
  monthlyToGoal: number;
  /** Left over once living and the goal are both funded. */
  monthlySurplus: number;

  /** The cash-flow projection to the goal's date. */
  projection: Projection | null;
  /** Month-by-month bank balance. */
  forecast: ForecastMonth[];

  /** Everything else, unchanged. Screens migrating off it read from here. */
  detail: SafeSpend;

  /** Empty when every relationship the contract requires holds. */
  consistency: ConsistencyBreach[];
}

/** Amounts agree to the fils; anything closer is floating-point noise. */
const TOLERANCE = 0.01;

function check(
  out: ConsistencyBreach[],
  rule: string,
  detail: string,
  left: number,
  right: number,
): void {
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > TOLERANCE) {
    out.push({ rule, detail, left, right });
  }
}

/**
 * Re-derives the relationships the contract requires, from the outputs rather
 * than from the inputs that produced them. Checking a figure against the
 * formula that made it proves nothing; checking it against a different route
 * to the same number is what catches two engines drifting apart.
 */
export function consistencyOf(s: SafeSpend, asOf: Date, fx = DEFAULT_FX_RATE): ConsistencyBreach[] {
  const out: ConsistencyBreach[] = [];

  if (s.projection) {
    check(
      out,
      'net-position',
      'Net position must be bank plus cash minus everything owed on the card.',
      s.projection.netNow,
      s.bank + (s.cash ?? 0) - s.projection.cardOutstanding,
    );

    check(
      out,
      'card-outstanding',
      'The card position the projection uses must be the one safeSpend reports.',
      s.projection.cardOutstanding,
      s.cc.stmtRem + s.cc.unbilled + s.cc.instBal,
    );
  }

  // The goal never receives more than its own schedule asks for, plus what
  // under-spending and under-budget obligations genuinely handed it.
  check(
    out,
    'goal-composition',
    'The monthly goal contribution must be its reserved share plus banked underspend plus obligation variance, less what the floor cost it.',
    s.goalMonthly,
    Math.max(0, s.goalReq + s.bankedToGoal + s.variance.toGoal - s.goalAbsorbed),
  );

  /*
   * What the month can set aside is exactly what the goal needs plus what is
   * left over. Nothing falls through the gap between them.
   *
   * This is the check that would have caught the goal screen announcing 6,327
   * a month of saving while the engine reserved 923: the two came from
   * different pools, estimated different ways, and nothing compared them.
   */
  check(
    out,
    'capacity-splits',
    'Capacity for saving must be exactly the goal reservation plus the surplus.',
    s.capacity.saving,
    s.goalReq + s.surplus,
  );

  check(
    out,
    'capacity-pool',
    'Capacity must be measured after the reserve, as the goal reservation is.',
    s.capacity.poolBeforeGoal - s.capacity.projectedSpend,
    s.capacity.saving,
  );

  /*
   * The projection's monthly requirement is for the STEERING goal, and must
   * match that goal's own schedule with what it already holds counted.
   *
   * Not `goalAsked`, which sums every goal — that was the mistake this check
   * caught in its own first draft. What it is really guarding is that the
   * projection sees the FUNDED goal: it used to be handed the raw ledger,
   * where an auto goal's `alloc` is zero because its progress comes from the
   * balance, so it demanded 1,634 a month from a goal that needed 923.
   */
  const feas = s.projection?.assessment.feasibility;
  if (s.projection && s.steering && feas !== 'unset' && feas !== 'met') {
    check(
      out,
      'required-monthly',
      "The projection's monthly requirement must be the steering goal's own schedule, counting what it already holds.",
      s.projection.assessment.requiredMonthlyAed,
      goalMonthlyRequirement(s.steering, fx),
    );
  }

  check(
    out,
    'goal-capped-by-need',
    'A goal is never reserved more than its schedule asks for.',
    Math.min(s.goalReq, s.goalAsked),
    s.goalReq,
  );

  // Every dirham the card holds is charged exactly once.
  check(
    out,
    'card-charged-once',
    'What the card claims this month plus what it defers must equal what it holds.',
    s.cardClaim.chargedThisMonth + s.cardClaim.deferred,
    s.cardClaim.totalOwed,
  );

  /*
   * A commitment is claimed or it is settled — never both.
   *
   * Checked by re-adding the per-line amounts rather than trusting the total
   * that was reported: if a settled line ever started claiming again, or a
   * claimed one were counted twice, these two would part company.
   */
  check(
    out,
    'commitment-once',
    'The commitments total must be exactly the lines that claim, each counted once.',
    s.commitObl,
    s.commitments.items.filter((i) => i.claims).reduce((a, i) => a + i.amount, 0),
  );

  check(
    out,
    'settled-claims-nothing',
    'A commitment already settled for this cycle claims nothing.',
    s.commitments.items.filter((i) => i.state === 'paid' && i.claims).length,
    0,
  );

  check(
    out,
    'paused-claims-nothing',
    'A paused commitment claims nothing.',
    s.commitments.items.filter((i) => i.state === 'paused' && i.claims).length,
    0,
  );

  check(
    out,
    'ssl-definition',
    "Today's remaining limit is the allowance less what today has already taken.",
    s.ssl,
    Math.max(0, s.allowance - s.flexToday),
  );

  // The reported day must be the day asked about.
  check(out, 'as-of', 'The cycle day must match the date evaluated.', s.daysElapsed, asOf.getDate());

  return out;
}

export function evaluateFinancialState(
  ledger: Ledger,
  asOf: Date = new Date(),
  options: EngineOptions = {},
): FinancialState {
  const fx = options.fx ?? DEFAULT_FX_RATE;
  const detail = safeSpend(ledger, fx, asOf);

  const projection = detail.projection;
  const daysInMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate();

  return {
    asOf,

    netPosition: projection
      ? projection.netNow
      : detail.liquid - (detail.cc.stmtRem + detail.cc.unbilled + detail.cc.instBal),
    bank: detail.bank,
    cash: detail.cash ?? 0,
    cardOutstanding: detail.cc.stmtRem + detail.cc.unbilled + detail.cc.instBal,

    // One identity, and it is the projection's when there is one. The plan and
    // the projection use the same rule to choose it; reading it from a single
    // place is what keeps that true as the rule changes.
    goal: projection?.goal ?? null,
    feasibility: projection?.assessment.feasibility ?? 'unset',

    today: detail.ssl,
    allowance: detail.allowance,
    spentToday: detail.flexToday,
    daily: detail.projection ? detail.dailyDerivation : null,

    monthlyLiving: projection?.monthlyDiscretionary ?? detail.allowance * daysInMonth,
    monthlyToGoal: detail.goalMonthly,
    monthlySurplus: detail.surplus,

    projection,
    forecast: forecast(
      forecastFromLedger(
        ledger,
        {
          bank: detail.bank,
          cash: detail.cash,
          commitObl: detail.commitObl,
          planT: detail.planT,
          cardDue: detail.cardDue,
          cardNextBill: detail.cardClaim.billNext,
          // The forecast reads the reconciled figure, so the balance it
          // projects and the goal the plan screen shows cannot disagree.
          goalReq: detail.goalReq,
          livingPool: detail.livingPool,
          cycleSpend: detail.cycleSpend,
          daysLeft: detail.daysLeft,
          daysInMonth,
        },
        ledger.commits.filter((k) => !k.paused).reduce((a, k) => a + (k.amt ?? 0), 0),
        ledger.planTf.reduce((a, tf) => a + tf.amt, 0),
      ),
      options.forecastMonths ?? 6,
      asOf,
    ),

    detail,
    consistency: consistencyOf(detail, asOf, fx),
  };
}
