import type { Ledger, Tx } from './types';

/**
 * International transfer analysis.
 *
 * Remittance is the single largest discretionary outflow for someone
 * supporting family abroad, and the part where small inefficiencies compound
 * quietly: a fee that looks trivial per transfer becomes a meaningful annual
 * number, and sending at a poor rate costs more than most people notice.
 */

export interface TransferStat {
  /** Who it went to, or a placeholder when unrecorded. */
  to: string;
  count: number;
  /** Total sent, excluding fees. */
  sent: number;
  /** Total paid in fees. */
  fees: number;
  /** Fees as a share of what was sent, 0–1. */
  feeRate: number;
  /** Total delivered in the destination currency, at the rates actually used. */
  delivered: number;
  lastSent: number;
}

function remits(ledger: Ledger, since: number): Tx[] {
  return ledger.tx.filter((x) => x.type === 'remit' && x.ts >= since);
}

/** The amount that actually reached the recipient, net of the fee. */
function net(x: Tx): number {
  return Math.max(0, x.amt - (x.fee ?? 0));
}

export function transferStats(
  ledger: Ledger,
  since: number,
  fallbackRate: number,
): TransferStat[] {
  const acc = new Map<string, TransferStat>();

  for (const x of remits(ledger, since)) {
    const to = (x.to ?? '').trim() || '—';
    const cur = acc.get(to) ?? {
      to,
      count: 0,
      sent: 0,
      fees: 0,
      feeRate: 0,
      delivered: 0,
      lastSent: 0,
    };
    cur.count += 1;
    cur.sent += net(x);
    cur.fees += x.fee ?? 0;
    // Use the rate stored on the transfer, falling back only when it predates
    // rate recording — otherwise today's rate would rewrite last year's total.
    cur.delivered += net(x) * (x.rate ?? fallbackRate);
    cur.lastSent = Math.max(cur.lastSent, x.ts);
    acc.set(to, cur);
  }

  return Array.from(acc.values())
    .map((s) => ({ ...s, feeRate: s.sent > 0 ? s.fees / s.sent : 0 }))
    .sort((a, b) => b.sent - a.sent);
}

export interface TransferSummary {
  count: number;
  sent: number;
  fees: number;
  delivered: number;
  /** Average sent per transfer. */
  averageSent: number;
  /** Fees as a share of what was sent. */
  feeRate: number;
  /** Best rate actually achieved in the window. */
  bestRate: number | null;
  /** Worst rate actually achieved. */
  worstRate: number | null;
  /**
   * What sending everything at the best achieved rate would have delivered,
   * minus what was actually delivered. A concrete, non-hypothetical cost.
   */
  lostToTiming: number;
}

export function transferSummary(
  ledger: Ledger,
  since: number,
  fallbackRate: number,
): TransferSummary {
  const rows = remits(ledger, since);
  const sent = rows.reduce((a, x) => a + net(x), 0);
  const fees = rows.reduce((a, x) => a + (x.fee ?? 0), 0);
  const delivered = rows.reduce((a, x) => a + net(x) * (x.rate ?? fallbackRate), 0);

  const rates = rows.map((x) => x.rate).filter((r): r is number => typeof r === 'number' && r > 0);
  const bestRate = rates.length ? Math.max(...rates) : null;
  const worstRate = rates.length ? Math.min(...rates) : null;

  return {
    count: rows.length,
    sent,
    fees,
    delivered,
    averageSent: rows.length ? sent / rows.length : 0,
    feeRate: sent > 0 ? fees / sent : 0,
    bestRate,
    worstRate,
    lostToTiming: bestRate != null ? Math.max(0, sent * bestRate - delivered) : 0,
  };
}

/**
 * Annualised fee cost, projected from the window observed.
 *
 * Shown because a 15 AED fee reads as nothing and 180 AED a year does not.
 */
export function annualFeeCost(summary: TransferSummary, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return (summary.fees / windowDays) * 365;
}
