import type { Ledger } from './types';

/**
 * Backup export.
 *
 * Writes the SAME shape `importBackup` reads, so export and import form a
 * closed loop — a backup taken today must restore to a byte-identical ledger,
 * and that round-trip is asserted in the tests rather than assumed. A backup
 * format that can only be written is not a backup.
 *
 * The wrapper mirrors the original PWA (`__v` / `savedAt` / `data`) so files
 * from either app remain interchangeable in both directions.
 */

export interface BackupEnvelope {
  __v: number;
  savedAt: number;
  data: Record<string, unknown>;
}

export interface ExportSettings {
  lang: 'ar' | 'en';
  theme: 'light' | 'dark';
  fxRate: number;
}

/** Builds the backup object. */
export function buildBackup(
  ledger: Ledger,
  settings: ExportSettings,
  now: Date = new Date(),
): BackupEnvelope {
  return {
    __v: 1,
    savedAt: now.getTime(),
    data: {
      // Settings, in the same keys the old format used.
      lang: settings.lang,
      theme: settings.theme,
      tf: { rate: String(settings.fxRate) },

      bankOpen: ledger.bankOpen,
      cashOpen: ledger.cashOpen,
      lastRecStr: ledger.lastRecStr,
      cardCfg: ledger.cardCfg,
      cardSetup: ledger.cardSetup,
      cardAdj: ledger.cardAdj,
      cardAdjNote: ledger.cardAdjNote ?? null,

      base: ledger.base,
      salStatus: ledger.salStatus,
      salActual: ledger.salActual,
      otEntries: ledger.otEntries,

      cats: ledger.cats,
      budgets: ledger.budgets,
      commits: ledger.commits,
      people: ledger.people,
      recv: ledger.recv,
      goals: ledger.goals,
      planTf: ledger.planTf,
      tx: ledger.tx,
      rules: ledger.rules,
      savTarget: ledger.savTarget,

      // Fields this app added. The importer ignores anything it does not know,
      // so including them is safe for the older app too.
      baseline: ledger.baseline ?? null,
      minDailySpend: ledger.minDailySpend ?? null,
      goalMode: ledger.goalMode ?? {},
      sslBasis: ledger.sslBasis ?? 'salary',
    },
  };
}

/** Pretty-printed backup text, ready to copy or share. */
export function backupToText(
  ledger: Ledger,
  settings: ExportSettings,
  now: Date = new Date(),
): string {
  return JSON.stringify(buildBackup(ledger, settings, now), null, 2);
}

/** Suggested filename, e.g. `masari-backup-2026-08-22.json`. */
export function backupFilename(now: Date = new Date()): string {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return `masari-backup-${iso}.json`;
}

export interface BackupSummary {
  transactions: number;
  goals: number;
  people: number;
  commitments: number;
  sizeKb: number;
}

/** Counts, so the user can see what a backup contains before sharing it. */
export function summarizeBackup(text: string, ledger: Ledger): BackupSummary {
  return {
    transactions: ledger.tx.length,
    goals: ledger.goals.length,
    people: ledger.people.length,
    commitments: ledger.commits.length,
    // Byte length, not character count — Arabic memos are multi-byte and the
    // difference is large enough to matter on a share sheet.
    sizeKb: Math.round((new TextEncoder().encode(text).length / 1024) * 10) / 10,
  };
}
