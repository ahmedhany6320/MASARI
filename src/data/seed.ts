import { importBackup, type ImportResult } from '../domain';
import seedBackup from './seedBackup.json';

/**
 * The bundled starting ledger.
 *
 * This is the owner's real backup from the original PWA, shipped inside the
 * app so the first launch can start from months of genuine history in one tap
 * instead of a blank slate or a copy-paste dance.
 *
 * It is offered, never forced: onboarding still allows a completely fresh
 * ledger, and `RestoreBackup` still accepts any other backup text. Anyone
 * shipping this app for other people should replace this file — or drop the
 * seed entirely, at which point `hasSeed` goes false and the button
 * disappears on its own.
 */
export const hasSeed = true;

/** The date the bundled backup was taken, for showing before it is applied. */
export const SEED_DATE = new Date(
  (seedBackup as { savedAt?: number }).savedAt ?? Date.now(),
);

let cached: ImportResult | null = null;

/**
 * Parses the bundled backup, memoised — importing is pure but walks the whole
 * transaction list, and there is no reason to redo it on every render.
 */
export function loadSeed(): ImportResult {
  if (!cached) cached = importBackup(seedBackup);
  return cached;
}
