import type { Ledger } from './types';

/**
 * Repairing a relational pull.
 *
 * The remote schema models the parts of the ledger worth querying. It has
 * never modelled all of it, and a pull rebuilt from those tables alone handed
 * back a ledger with holes in it: no overtime entries, no receivables, no
 * planned transfers, no categorisation rules, no card correction note, no
 * commitment actuals, and — worst — transactions stripped of the `commitId`
 * that marks an expense as the settlement of a bill already budgeted for.
 *
 * Since a pull *replaces* the device's state, those holes were not stale
 * values. They were an erasure, and the `commitId` one silently changed the
 * arithmetic: a rent payment that comes back unmarked is counted as
 * discretionary spending while its commitment is charged again.
 *
 * New installs now write the whole ledger to `ledgers.doc` and a pull reads
 * that back, so none of this arises. This function is for the remotes written
 * before that: it takes what the relational tables could carry and fills every
 * gap from the device, which still holds the data. The rule is one line —
 * **a pull may replace a field the remote can represent, and may never blank
 * one it cannot.**
 */

/** Ledger-level fields no table on the remote has ever held. */
export const UNSYNCED_LEDGER_FIELDS = [
  'otEntries',
  'recv',
  'planTf',
  'rules',
  'cardAdjNote',
  'baseline',
  'minDailySpend',
  'comfortDailySpend',
  'bufferTarget',
  'goalMode',
] as const;

/** Per-row fields the remote columns do not cover. */
export const UNSYNCED_TX_FIELDS = ['commitId', 'back', 'fee', 'rate', 'to'] as const;
export const UNSYNCED_COMMITMENT_FIELDS = ['actual'] as const;

function keep<T extends object, K extends keyof T>(
  remoteRow: T,
  localRow: T | undefined,
  fields: readonly K[],
): T {
  if (!localRow) return remoteRow;
  const out = { ...remoteRow };
  for (const f of fields) {
    if (out[f] === undefined && localRow[f] !== undefined) out[f] = localRow[f];
  }
  return out;
}

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Fills the gaps a relational pull leaves, from the ledger already on the
 * device.
 *
 * Rows the remote returned win on every field it can actually carry — that is
 * the point of pulling. Only the fields listed above, which the remote has no
 * column for, fall back to local. A row the device has never seen is taken as
 * it came.
 */
export function mergeRelationalPull(remote: Ledger, local: Ledger): Ledger {
  const localTx = byId(local.tx);
  const localCommits = byId(local.commits);

  return {
    ...remote,

    // Collections the remote has no table for at all.
    otEntries: remote.otEntries.length ? remote.otEntries : local.otEntries,
    recv: remote.recv.length ? remote.recv : local.recv,
    planTf: remote.planTf.length ? remote.planTf : local.planTf,
    rules: Object.keys(remote.rules).length ? remote.rules : local.rules,

    // Scalars the remote has no column for. `undefined` means "not carried";
    // an explicit null the user set is preserved as null.
    cardAdjNote: remote.cardAdjNote ?? local.cardAdjNote,
    baseline: remote.baseline ?? local.baseline,
    minDailySpend: remote.minDailySpend ?? local.minDailySpend,
    comfortDailySpend: remote.comfortDailySpend ?? local.comfortDailySpend,
    bufferTarget: remote.bufferTarget ?? local.bufferTarget,
    goalMode:
      remote.goalMode && Object.keys(remote.goalMode).length
        ? remote.goalMode
        : local.goalMode,

    tx: remote.tx.map((x) => keep(x, localTx.get(x.id), UNSYNCED_TX_FIELDS)),
    commits: remote.commits.map((k) =>
      keep(k, localCommits.get(k.id), UNSYNCED_COMMITMENT_FIELDS),
    ),
  };
}
