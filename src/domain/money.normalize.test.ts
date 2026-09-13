import { describe, expect, it } from 'vitest';
import { MONEY_EPSILON, normalizeAmount, normalizeMagnitude, sameMoney } from './money';

describe('normalizeAmount', () => {
  it('kills the drift binary floating point accumulates', () => {
    expect(normalizeAmount(0.1 + 0.2)).toBe(0.3);
    expect(normalizeAmount(1775.0000000001)).toBe(1775);
    expect(normalizeAmount(108.98499)).toBe(108.98);
  });

  it('keeps the sign, because a reconciliation goes both ways', () => {
    expect(normalizeAmount(-35.256)).toBe(-35.26);
  });

  it('turns nonsense into zero rather than storing it', () => {
    expect(normalizeAmount(NaN)).toBe(0);
    expect(normalizeAmount(Infinity)).toBe(0);
    expect(normalizeAmount(-Infinity)).toBe(0);
  });

  it('leaves an already-clean amount alone', () => {
    for (const n of [0, 20, 1800, 9500.5, 0.01]) expect(normalizeAmount(n)).toBe(n);
  });
});

describe('normalizeMagnitude', () => {
  it('reads a typed minus as the amount, not as a direction', () => {
    // An expense of -50 would otherwise raise the balance.
    expect(normalizeMagnitude(-50)).toBe(50);
  });

  it('rounds as well as unsigns', () => {
    expect(normalizeMagnitude(-0.1 - 0.2)).toBe(0.3);
  });

  it('has no negative zero', () => {
    expect(Object.is(normalizeMagnitude(-0), 0)).toBe(true);
  });
});

describe('sameMoney', () => {
  it('treats amounts equal below the minor unit as equal', () => {
    expect(sameMoney(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameMoney(1800, 1800.004)).toBe(true);
  });

  it('still separates a real fils', () => {
    expect(sameMoney(1800, 1800.01)).toBe(false);
  });

  it('is the tolerance the epsilon promises', () => {
    expect(sameMoney(0, MONEY_EPSILON)).toBe(false);
    expect(sameMoney(0, MONEY_EPSILON / 2)).toBe(true);
  });
});
