import { describe, expect, it } from 'vitest';
import { forecast, type ForecastInputs } from './forecast';

const NOW = new Date(2026, 8, 12, 12, 0, 0); // 12 September

function inputs(over: Partial<ForecastInputs> = {}): ForecastInputs {
  return {
    openingBalance: 6000,
    salary: 11000,
    commitments: 2100,
    transfers: 850,
    cardFirstMonth: 4982,
    cardOngoing: 1500,
    goal: 4000,
    living: 1240,
    remainingThisMonth: { commitments: 300, transfers: 0, living: 700 },
    ...over,
  };
}

describe('forecast — the current month is already part spent', () => {
  const f = forecast(inputs(), 3, NOW);

  it('adds no salary to the month it is already in', () => {
    // September's salary landed before today; adding it again would invent
    // eleven thousand dirhams at the exact moment the user is checking.
    expect(f[0]?.salary).toBe(0);
    expect(f[1]?.salary).toBe(11000);
  });

  it('charges only what this month still owes', () => {
    expect(f[0]?.commitments).toBe(300);
    expect(f[0]?.living).toBe(700);
    // Later months carry the full plan.
    expect(f[1]?.commitments).toBe(2100);
    expect(f[1]?.living).toBe(1240);
  });

  it('opens on the balance actually held', () => {
    expect(f[0]?.opening).toBe(6000);
  });

  it('closes this month on arithmetic anyone can check by hand', () => {
    // 6000 − 300 − 0 − 4982 − 700. The goal is NOT subtracted: it is money
    // earmarked inside the balance, not money that has left it.
    expect(f[0]?.closing).toBe(6000 - 300 - 0 - 4982 - 700);
  });

  it('does not treat an earmarked goal as an outflow', () => {
    // Otherwise the closing balance comes out identical with and without
    // obligations, because the goal absorbs whatever they do not take.
    const noGoal = forecast(inputs({ goal: 0 }), 3, NOW);
    expect(noGoal[0]?.closing).toBe(f[0]?.closing);
  });

  it('still reports what has been earmarked', () => {
    expect(f[0]?.goal).toBe(4000);
    expect(f[0]?.savedToDate).toBe(4000);
  });
});

describe('forecast — each month opens where the last one closed', () => {
  const f = forecast(inputs(), 6, NOW);

  it('carries the closing balance forward', () => {
    for (let i = 1; i < f.length; i++) {
      expect(f[i]?.opening).toBe(f[i - 1]?.closing);
    }
  });

  it('walks the calendar forward, rolling the year over', () => {
    expect(f[0]?.month).toBe(8);
    expect(f[0]?.year).toBe(2026);
    const dec = forecast(inputs(), 6, new Date(2026, 10, 1));
    expect(dec[2]?.month).toBe(0);
    expect(dec[2]?.year).toBe(2027);
  });

  it('accumulates what has been set aside', () => {
    expect(f[0]?.savedToDate).toBe(4000);
    expect(f[2]?.savedToDate).toBe(12000);
  });

  it('drops to the ongoing card bill after the first month', () => {
    expect(f[0]?.card).toBe(4982);
    expect(f[1]?.card).toBe(1500);
    expect(f[2]?.card).toBe(1500);
  });
});

describe('forecast — edges', () => {
  it('returns nothing for a zero-month horizon', () => {
    expect(forecast(inputs(), 0, NOW)).toEqual([]);
    expect(forecast(inputs(), -3, NOW)).toEqual([]);
  });

  it('reports a balance going negative rather than hiding it', () => {
    // A forecast that floors at zero is useless: running out is the single
    // most important thing it could tell someone.
    const broke = forecast(inputs({ openingBalance: 0, salary: 500 }), 4, NOW);
    expect(broke.some((m) => m.closing < 0)).toBe(true);
  });

  it('projects a steady surplus when the plan actually works', () => {
    const good = forecast(
      inputs({ cardFirstMonth: 0, cardOngoing: 0, goal: 1000, living: 1240 }),
      4,
      NOW,
    );
    expect(good[3]?.closing).toBeGreaterThan(good[1]?.closing ?? 0);
  });

  it('stays finite with everything at zero', () => {
    const flat = forecast(
      inputs({
        openingBalance: 0, salary: 0, commitments: 0, transfers: 0,
        cardFirstMonth: 0, cardOngoing: 0, goal: 0, living: 0,
        remainingThisMonth: { commitments: 0, transfers: 0, living: 0 },
      }),
      3,
      NOW,
    );
    expect(flat.every((m) => Number.isFinite(m.closing))).toBe(true);
    expect(flat[2]?.closing).toBe(0);
  });
});
