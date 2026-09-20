import { describe, expect, it } from 'vitest';
import { formatAmount, formatEgp, formatMoney, parseAmount } from './money';
import { overtimeTotal } from './overtime';

describe('formatAmount', () => {
  it('rounds to whole units and groups thousands', () => {
    expect(formatAmount(1234567.89)).toBe('1,234,568');
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(-1500)).toBe('-1,500');
  });

  it('keeps Western digits so the numbers read the same in both languages', () => {
    expect(formatAmount(11000)).toBe('11,000');
  });

  it('degrades to zero rather than printing NaN', () => {
    expect(formatAmount(Number.NaN)).toBe('0');
    expect(formatAmount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('formatMoney / formatEgp', () => {
  it('labels the salary currency per language', () => {
    expect(formatMoney(500, 'ar')).toBe('500 د.إ');
    expect(formatMoney(500, 'en')).toBe('500 AED');
  });

  it('labels Egyptian pounds per language', () => {
    expect(formatEgp(1_050_000, 'ar')).toBe('1,050,000 ج.م');
    expect(formatEgp(1_050_000, 'en')).toBe('1,050,000 EGP');
  });
});

describe('parseAmount', () => {
  it('parses plain and grouped input', () => {
    expect(parseAmount('250')).toBe(250);
    expect(parseAmount('1,250.50')).toBe(1250.5);
  });

  it('accepts Arabic-Indic digits from an Arabic keyboard', () => {
    expect(parseAmount('١٢٣')).toBe(123);
    expect(parseAmount('١٢٣٤٥')).toBe(12345);
  });

  it('accepts the Arabic decimal separator', () => {
    expect(parseAmount('١٢٫٥')).toBe(12.5);
  });

  it('rejects empty and non-numeric input', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('overtimeTotal', () => {
  it('multiplies hours by rate by multiplier', () => {
    expect(overtimeTotal([{ id: 'o1', h: 10, rate: 50, mult: 1.25, date: '2026-08-05' }])).toBe(625);
  });

  it('sums several entries', () => {
    expect(
      overtimeTotal([
        { id: 'o1', h: 10, rate: 50, mult: 1.25, date: '2026-08-05' },
        { id: 'o2', h: 4, rate: 50, mult: 1.5, date: '2026-08-07' },
      ]),
    ).toBe(925);
  });

  it('is zero with no entries', () => {
    expect(overtimeTotal([])).toBe(0);
  });
});
