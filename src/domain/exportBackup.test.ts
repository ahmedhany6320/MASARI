import { describe, expect, it } from 'vitest';
import real from './__fixtures__/backup-2026-08-14.json';
import { backupFilename, backupToText, buildBackup, summarizeBackup } from './exportBackup';
import { importBackup } from './importBackup';

const NOW = new Date(2026, 7, 22, 12, 0, 0);
const SETTINGS = { lang: 'ar' as const, theme: 'light' as const, fxRate: 13.6 };

describe('export → import round trip', () => {
  const { ledger, settings } = importBackup(real);
  const text = backupToText(ledger, settings, NOW);
  const back = importBackup(JSON.parse(text));

  it('restores every transaction', () => {
    expect(back.counts.transactions).toBe(ledger.tx.length);
    expect(back.ledger.tx.map((x) => x.id)).toEqual(ledger.tx.map((x) => x.id));
  });

  it('restores balances exactly', () => {
    expect(back.ledger.bankOpen).toBe(ledger.bankOpen);
    expect(back.ledger.cashOpen).toBe(ledger.cashOpen);
    expect(back.ledger.base).toBe(ledger.base);
    expect(back.ledger.cardAdj).toBe(ledger.cardAdj);
  });

  it('restores the card setup', () => {
    expect(back.ledger.cardSetup).toEqual(ledger.cardSetup);
    expect(back.ledger.cardCfg).toEqual(ledger.cardCfg);
  });

  it('restores people, goals, receivables and rules', () => {
    expect(back.ledger.people).toEqual(ledger.people);
    expect(back.ledger.goals).toEqual(ledger.goals);
    expect(back.ledger.recv).toEqual(ledger.recv);
    expect(back.ledger.rules).toEqual(ledger.rules);
  });

  it('restores settings', () => {
    expect(back.settings.lang).toBe(settings.lang);
    expect(back.settings.fxRate).toBe(settings.fxRate);
  });

  it('is stable — exporting a restored ledger gives the same text', () => {
    const again = backupToText(back.ledger, back.settings, NOW);
    expect(again).toBe(text);
  });
});

describe('buildBackup', () => {
  const { ledger } = importBackup(real);

  it('carries the fields this app added', () => {
    const withExtras = {
      ...ledger,
      minDailySpend: 60,
      goalMode: { egypt: 'horizon' as const },
      baseline: { ts: 123, cycleSpentBefore: 300 },
    };
    const env = buildBackup(withExtras, SETTINGS, NOW);
    expect(env.data.minDailySpend).toBe(60);
    expect(env.data.goalMode).toEqual({ egypt: 'horizon' });
    expect(env.data.baseline).toEqual({ ts: 123, cycleSpentBefore: 300 });
  });

  it('round-trips the new fields too', () => {
    const withExtras = {
      ...ledger,
      minDailySpend: 75,
      goalMode: { egypt: 'horizon' as const },
      baseline: { ts: 999, cycleSpentBefore: 250 },
    };
    const back = importBackup(buildBackup(withExtras, SETTINGS, NOW));
    expect(back.ledger.minDailySpend).toBe(75);
    expect(back.ledger.goalMode).toEqual({ egypt: 'horizon' });
    expect(back.ledger.baseline).toEqual({ ts: 999, cycleSpentBefore: 250 });
  });

  it('leaves the new fields empty for a backup from the original app', () => {
    // The real fixture predates all three, and must still import cleanly.
    const back = importBackup(real);
    expect(back.ledger.minDailySpend).toBeNull();
    expect(back.ledger.baseline).toBeUndefined();
    expect(back.ledger.goalMode).toBeUndefined();
  });

  it('ignores a goal mode it does not recognise', () => {
    const back = importBackup({ data: { goalMode: { g1: 'nonsense', g2: 'horizon' } } });
    expect(back.ledger.goalMode).toEqual({ g2: 'horizon' });
  });

  it('stamps the time it was taken', () => {
    expect(buildBackup(ledger, SETTINGS, NOW).savedAt).toBe(NOW.getTime());
  });
});

describe('backupFilename', () => {
  it('is dated and zero padded', () => {
    expect(backupFilename(new Date(2026, 0, 5))).toBe('masari-backup-2026-01-05.json');
  });
});

describe('summarizeBackup', () => {
  const { ledger, settings } = importBackup(real);

  it('counts what the file holds', () => {
    const text = backupToText(ledger, settings, NOW);
    const s = summarizeBackup(text, ledger);
    expect(s.transactions).toBe(44);
    expect(s.people).toBe(3);
    expect(s.sizeKb).toBeGreaterThan(0);
  });

  it('measures bytes, not characters — Arabic memos are multi-byte', () => {
    const text = backupToText(ledger, settings, NOW);
    const s = summarizeBackup(text, ledger);
    expect(s.sizeKb).toBeGreaterThan(text.length / 1024 / 2);
  });
});
