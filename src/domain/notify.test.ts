import { describe, expect, it } from 'vitest';
import { emptyLedger } from './defaults';
import {
  commitmentReminder,
  dueCommitments,
  morningBrief,
  nearLimitAlert,
  overspendAlert,
} from './notify';
import { safeSpend } from './safeSpend';
import type { Commitment, Ledger, Tx } from './types';

const FX = 13.6;
const NOW = new Date(2026, 7, 10, 12, 0, 0);
const DAY_START = new Date(2026, 7, 10).getTime();

let seq = 0;
function spend(amt: number): Tx {
  return { id: `x${seq++}`, ts: DAY_START + 3600e3, type: 'expense', acct: 'card', amt };
}
function commitment(over: Partial<Commitment> = {}): Commitment {
  return { id: `k${seq++}`, ar: 'إيجار', en: 'Rent', amt: 3000, day: 12, paused: false, paidMonth: false, ...over };
}
function ledger(over: Partial<Ledger> = {}): Ledger {
  return { ...emptyLedger(), base: 11000, ...over };
}

describe('morningBrief', () => {
  it('leads with the number, which is what survives lock-screen truncation', () => {
    const c = safeSpend(ledger(), FX, NOW);
    expect(morningBrief(c, 'ar').title).toBe('النهارده: 500 د.إ');
    expect(morningBrief(c, 'en').title).toBe('Today: 500 AED');
  });

  it('says plainly when there is nothing to spend', () => {
    const c = safeSpend(ledger({ commits: [commitment({ amt: 15000 })] }), FX, NOW);
    expect(morningBrief(c, 'ar').body).toContain('مفيش حد آمن');
    expect(morningBrief(c, 'en').body).toContain('Nothing safe to spend');
  });

  it('includes the days remaining until payday', () => {
    const c = safeSpend(ledger(), FX, NOW);
    expect(morningBrief(c, 'en').body).toContain('22 days');
  });
});

describe('overspendAlert', () => {
  it('stays silent on a normal day — a daily "all fine" trains people to ignore it', () => {
    const c = safeSpend(ledger({ tx: [spend(100)] }), FX, NOW);
    expect(overspendAlert(c, 'ar')).toBeNull();
  });

  it('fires once the day is over its allowance', () => {
    const c = safeSpend(ledger({ tx: [spend(700)] }), FX, NOW);
    const msg = overspendAlert(c, 'en');
    expect(msg).not.toBeNull();
    expect(msg?.body).toContain('200 AED over');
  });

  it('tells you what tomorrow costs', () => {
    const c = safeSpend(ledger({ tx: [spend(700)] }), FX, NOW);
    expect(overspendAlert(c, 'en')?.body).toContain("Tomorrow's limit");
  });
});

describe('nearLimitAlert', () => {
  it('is silent well below the threshold', () => {
    const c = safeSpend(ledger({ tx: [spend(100)] }), FX, NOW);
    expect(nearLimitAlert(c, 'ar')).toBeNull();
  });

  it('fires once past 80% of the day', () => {
    const c = safeSpend(ledger({ tx: [spend(420)] }), FX, NOW);
    expect(nearLimitAlert(c, 'en')).not.toBeNull();
  });

  it('defers to the overspend alert once the limit is actually passed', () => {
    const c = safeSpend(ledger({ tx: [spend(700)] }), FX, NOW);
    expect(nearLimitAlert(c, 'en')).toBeNull();
  });

  it('is silent when there is no allowance to be near', () => {
    const c = safeSpend(ledger({ commits: [commitment({ amt: 15000 })] }), FX, NOW);
    expect(nearLimitAlert(c, 'en')).toBeNull();
  });
});

describe('dueCommitments', () => {
  it('finds a commitment falling due within the window', () => {
    const s = ledger({ commits: [commitment({ day: 12 })] });
    expect(dueCommitments(s, NOW)).toHaveLength(1);
  });

  it('ignores one that is still far off', () => {
    const s = ledger({ commits: [commitment({ day: 25 })] });
    expect(dueCommitments(s, NOW)).toHaveLength(0);
  });

  it('wraps across the month boundary', () => {
    // On the 30th, a bill due on the 2nd is two days away, not twenty-eight.
    const endOfMonth = new Date(2026, 7, 30, 12, 0, 0);
    const s = ledger({ commits: [commitment({ day: 2 })] });
    expect(dueCommitments(s, endOfMonth)).toHaveLength(1);
  });

  it('never nags about a bill already paid or paused', () => {
    const s = ledger({
      commits: [
        commitment({ day: 12, paidMonth: true }),
        commitment({ day: 12, paused: true }),
      ],
    });
    expect(dueCommitments(s, NOW)).toHaveLength(0);
  });

  it('skips commitments with no amount set', () => {
    const s = ledger({ commits: [commitment({ day: 12, amt: null })] });
    expect(dueCommitments(s, NOW)).toHaveLength(0);
  });
});

describe('commitmentReminder', () => {
  it('is null with nothing due', () => {
    expect(commitmentReminder([], 'ar')).toBeNull();
  });

  it('sums several commitments', () => {
    const msg = commitmentReminder(
      [commitment({ amt: 3000 }), commitment({ en: 'Phone', amt: 200 })],
      'en',
    );
    expect(msg?.body).toContain('3,200 AED');
    expect(msg?.title).toBe('Commitments are due');
  });

  it('uses the singular for one', () => {
    expect(commitmentReminder([commitment()], 'en')?.title).toBe('A commitment is due');
    expect(commitmentReminder([commitment()], 'ar')?.title).toBe('التزام قرّب');
  });
});
