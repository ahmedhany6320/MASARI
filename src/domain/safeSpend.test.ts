import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import { safeSpend, savingSummary } from './safeSpend';
import type { Commitment, Goal, Ledger, Tx } from './types';

const FX = 13.6;

/**
 * Fixed clock: 10 Aug 2026, noon, LOCAL time. Built with the local-time
 * constructor on purpose — the engine derives day and month boundaries with
 * local constructors too, so a UTC literal here would make these tests pass or
 * fail depending on the machine's timezone.
 *
 * From this instant to payday (1 Sep 00:00) is 21 days 12 hours, which rounds
 * to 22 days left. An 11,000 living pool therefore divides into a clean 500/day.
 */
const NOW = new Date(2026, 7, 10, 12, 0, 0);
const DAY_START = new Date(2026, 7, 10, 0, 0, 0).getTime();
const MONTH_START = new Date(2026, 7, 1, 0, 0, 0).getTime();

let seq = 0;
function spend(amt: number, ts: number, over: Partial<Tx> = {}): Tx {
  return { id: `x${seq++}`, ts, type: 'expense', acct: 'card', amt, ...over };
}
function commitment(amt: number, over: Partial<Commitment> = {}): Commitment {
  return { id: `k${seq++}`, ar: '', en: '', amt, day: 5, paused: false, paidMonth: false, ...over };
}
function goal(over: Partial<Goal> = {}): Goal {
  return { id: `g${seq++}`, ar: 'هدف', en: 'Goal', target: null, alloc: 0, months: null, auto: false, ...over };
}
function ledger(over: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(), base: 11000, ...over };
}

describe('safeSpend — the cycle window', () => {
  it('counts the days remaining until the next payday', () => {
    expect(safeSpend(ledger(), FX, NOW).daysLeft).toBe(22);
  });

  it('never reports fewer than one day left, even on payday eve', () => {
    const lastMoment = new Date(2026, 7, 31, 23, 59, 0);
    expect(safeSpend(ledger(), FX, lastMoment).daysLeft).toBe(1);
  });

  it('sets payday to the first of the following month', () => {
    expect(safeSpend(ledger(), FX, NOW).nextPay.getTime()).toBe(new Date(2026, 8, 1).getTime());
  });

  it('rolls the year over in December', () => {
    const dec = new Date(2026, 11, 15, 12, 0, 0);
    expect(safeSpend(ledger(), FX, dec).nextPay.getTime()).toBe(new Date(2027, 0, 1).getTime());
  });
});

describe('safeSpend — the living pool', () => {
  it('is the whole salary when nothing is claimed against it', () => {
    const c = safeSpend(ledger(), FX, NOW);
    expect(c.livingPool).toBe(11000);
    expect(c.ssl).toBe(500);
  });

  it('subtracts commitments, planned transfers and goal contributions', () => {
    const s = ledger({
      commits: [commitment(2000)],
      planTf: [{ id: 'p1', amt: 1000, day: 20 }],
      goals: [goal({ target: 12000, months: 12 })],
    });
    const c = safeSpend(s, FX, NOW);
    expect(c.commitObl).toBe(2000);
    expect(c.planT).toBe(1000);
    expect(c.goalReq).toBe(1000);
    expect(c.livingPool).toBe(7000);
  });

  it('ignores paused and already-paid commitments', () => {
    const s = ledger({
      commits: [
        commitment(2000, { paused: true }),
        commitment(1500, { paidMonth: true }),
        commitment(500),
      ],
    });
    expect(safeSpend(s, FX, NOW).commitObl).toBe(500);
  });

  it('ignores commitments with no amount set yet', () => {
    const s = ledger({ commits: [commitment(null as unknown as number)] });
    expect(safeSpend(s, FX, NOW).commitObl).toBe(0);
  });
});

describe('safeSpend — the daily limit', () => {
  it("does not let today's own spending shrink today's allowance", () => {
    // The add-back is the point: allowance stays at the full 500 the day was
    // entitled to, and only the remaining headroom falls.
    const s = ledger({ tx: [spend(100, DAY_START + 3600e3)] });
    const c = safeSpend(s, FX, NOW);
    expect(c.flexToday).toBe(100);
    expect(c.allowance).toBe(500);
    expect(c.ssl).toBe(400);
  });

  it('reaches zero rather than going negative once the day is overspent', () => {
    const s = ledger({ tx: [spend(700, DAY_START + 3600e3)] });
    const c = safeSpend(s, FX, NOW);
    expect(c.ssl).toBe(0);
    expect(c.overToday).toBe(200);
  });

  it('reports nothing safe to spend when the whole cycle is overspent', () => {
    const s = ledger({ commits: [commitment(11000)] });
    const c = safeSpend(s, FX, NOW);
    expect(c.livingPool).toBe(0);
    expect(c.allowance).toBe(0);
    expect(c.ssl).toBe(0);
  });

  it('stays at zero when commitments exceed the salary outright', () => {
    const s = ledger({ commits: [commitment(15000)] });
    const c = safeSpend(s, FX, NOW);
    expect(c.livingPool).toBe(-4000);
    expect(c.ssl).toBe(0);
    expect(c.tomorrow).toBe(0);
  });

  it('spreads earlier spending in the cycle across the days that remain', () => {
    const s = ledger({ tx: [spend(2200, MONTH_START + 86400e3)] });
    const c = safeSpend(s, FX, NOW);
    expect(c.cycleSpend).toBe(2200);
    expect(c.spendable).toBe(8800);
    expect(c.flexToday).toBe(0);
    expect(c.allowance).toBeCloseTo(400, 10);
    expect(c.ssl).toBeCloseTo(400, 10);
  });

  it('shows tomorrow improving when today is left untouched', () => {
    const c = safeSpend(ledger(), FX, NOW);
    expect(c.tomorrow).toBeCloseTo(11000 / 21, 10);
    expect(c.tomorrow).toBeGreaterThan(c.allowance);
  });

  it('shows tomorrow shrinking after an overspent day', () => {
    const s = ledger({ tx: [spend(2000, DAY_START + 3600e3)] });
    const c = safeSpend(s, FX, NOW);
    expect(c.tomorrow).toBeCloseTo(9000 / 21, 10);
    expect(c.tomorrow).toBeLessThan(500);
  });

  it('excludes spending from a previous cycle', () => {
    const july = new Date(2026, 6, 20).getTime();
    const s = ledger({ tx: [spend(5000, july)] });
    const c = safeSpend(s, FX, NOW);
    expect(c.cycleSpend).toBe(0);
    expect(c.ssl).toBe(500);
  });

  it('counts spending on every account, not just the card', () => {
    const s = ledger({
      tx: [
        spend(100, DAY_START + 1000, { acct: 'card' }),
        spend(50, DAY_START + 2000, { acct: 'cash' }),
        spend(50, DAY_START + 3000, { acct: 'bank' }),
      ],
    });
    expect(safeSpend(s, FX, NOW).flexToday).toBe(200);
  });

  it('does not count income or transfers as spending', () => {
    const s = ledger({
      tx: [
        { id: 'i1', ts: DAY_START + 1000, type: 'income', acct: 'bank', amt: 5000 },
        { id: 'r1', ts: DAY_START + 2000, type: 'remit', amt: 3000 },
      ],
    });
    const c = safeSpend(s, FX, NOW);
    expect(c.flexToday).toBe(0);
    expect(c.ssl).toBe(500);
  });
});

describe('safeSpend — balances and the card', () => {
  it('reports liquid money as bank plus cash, excluding card headroom', () => {
    const s = ledger({ bankOpen: 20000, cashOpen: 500, cardCfg: { limit: 20000, closeDay: 1, dueDay: 25 } });
    const c = safeSpend(s, FX, NOW);
    expect(c.bank).toBe(20000);
    expect(c.cash).toBe(500);
    expect(c.liquid).toBe(20500);
  });

  it('treats liquid as the bank alone when cash is not tracked', () => {
    const c = safeSpend(ledger({ bankOpen: 20000, cashOpen: null }), FX, NOW);
    expect(c.cash).toBeNull();
    expect(c.liquid).toBe(20000);
  });

  it('deducts what the card takes this month, but not this cycle spending twice', () => {
    const s = ledger({
      cardSetup: { stmt0: 4000, unbilled0: 0, instBal: 6000, instMo: 500 },
      cardCfg: { limit: 20000, closeDay: 1, dueDay: 25 },
    });
    const c = safeSpend(s, FX, NOW);

    // Statement (spent LAST cycle, payable now) plus this month's installment
    // are real claims on this salary and must come out of the pool.
    expect(c.cardDue).toBe(4500);
    expect(c.livingPool).toBe(11000 - 4500);

    // The wider outstanding figure stays available for display.
    expect(c.cardObl).toBe(4500);
  });

  it('does not deduct unbilled card spending, which is already an expense', () => {
    const spentToday = spend(300, DAY_START + 3600e3, { acct: 'card' });
    const s = ledger({
      cardSetup: { stmt0: 0, unbilled0: 0, instBal: 0, instMo: 0 },
      cardCfg: { limit: 20000, closeDay: 1, dueDay: 25 },
      tx: [spentToday],
    });
    const c = safeSpend(s, FX, NOW);

    // The 300 shows up as unbilled on the card AND as this cycle's spending.
    expect(c.cc.unbilled).toBe(300);
    expect(c.cycleSpend).toBe(300);
    // It must be charged once, via cycleSpend — never again via the pool.
    expect(c.cardDue).toBe(0);
    expect(c.livingPool).toBe(11000);
    expect(c.spendable).toBe(10700);
  });

  it('sums money already earmarked for goals', () => {
    const s = ledger({ goals: [goal({ alloc: 3000 }), goal({ alloc: 1500 })] });
    expect(safeSpend(s, FX, NOW).protectedAlloc).toBe(4500);
  });
});

describe('savingSummary', () => {
  it('is the month income minus the month outgoings', () => {
    const s = ledger({
      tx: [
        { id: 'i1', ts: MONTH_START + 1000, type: 'income', acct: 'bank', amt: 11000 },
        spend(3000, MONTH_START + 2000),
      ],
    });
    const sv = savingSummary(s, NOW);
    expect(sv.incomeM).toBe(11000);
    expect(sv.spendM).toBe(3000);
    expect(sv.actual).toBe(8000);
  });

  it('counts the opening salary as income even though it does not post', () => {
    // `post: false` means "already in the opening balance" — a statement about
    // balance arithmetic, not about whether the money was earned this month.
    const s = ledger({
      tx: [{ id: 's1', ts: MONTH_START, type: 'income', acct: 'bank', amt: 11000, post: false }],
    });
    expect(savingSummary(s, NOW).incomeM).toBe(11000);
  });

  it('treats a goal remittance as saving, not spending', () => {
    const s = ledger({
      tx: [
        { id: 'i1', ts: MONTH_START + 1000, type: 'income', acct: 'bank', amt: 11000 },
        { id: 'r1', ts: MONTH_START + 2000, type: 'remit', amt: 4000, purpose: 'goal' },
      ],
    });
    const sv = savingSummary(s, NOW);
    expect(sv.spendM).toBe(0);
    expect(sv.actual).toBe(11000);
  });

  it('treats a non-goal remittance as spending', () => {
    const s = ledger({
      tx: [
        { id: 'i1', ts: MONTH_START + 1000, type: 'income', acct: 'bank', amt: 11000 },
        { id: 'r1', ts: MONTH_START + 2000, type: 'remit', amt: 4000, purpose: 'fiancee' },
      ],
    });
    expect(savingSummary(s, NOW).spendM).toBe(4000);
  });

  it('reports no surplus or shortfall when no target is set', () => {
    const sv = savingSummary(ledger({ savTarget: null }), NOW);
    expect(sv.extra).toBeNull();
    expect(sv.short).toBeNull();
  });

  it('reports the shortfall against a target', () => {
    const s = ledger({
      savTarget: 5000,
      tx: [{ id: 'i1', ts: MONTH_START + 1000, type: 'income', acct: 'bank', amt: 3000 }],
    });
    const sv = savingSummary(s, NOW);
    expect(sv.short).toBe(2000);
    expect(sv.extra).toBe(0);
  });

  it('reports the surplus above a target', () => {
    const s = ledger({
      savTarget: 5000,
      tx: [{ id: 'i1', ts: MONTH_START + 1000, type: 'income', acct: 'bank', amt: 8000 }],
    });
    const sv = savingSummary(s, NOW);
    expect(sv.extra).toBe(3000);
    expect(sv.short).toBe(0);
  });

  it('ignores last month entirely', () => {
    const s = ledger({
      tx: [{ id: 'i1', ts: new Date(2026, 6, 15).getTime(), type: 'income', acct: 'bank', amt: 11000 }],
    });
    expect(savingSummary(s, NOW).incomeM).toBe(0);
  });
});
