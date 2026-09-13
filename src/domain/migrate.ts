/**
 * Persisted-state migrations.
 *
 * The saved ledger used to carry no version at all. Schema changes were
 * handled by ad-hoc code in the store's `merge`, which ran on every single
 * launch — so a fix-up meant to correct a stale default also quietly undid the
 * same choice when the user later made it deliberately, and there was no way
 * to tell which build had written a given save.
 *
 * A version plus an ordered chain fixes both. Each step is named for what it
 * repairs, runs exactly once, and takes the state from `n` to `n + 1`. Steps
 * are never rewritten after they ship — a shipped migration is history, and
 * editing it changes what happens to data already on someone's phone.
 *
 * Everything here is pure and works on loosely-typed objects, because a save
 * written by an older build is by definition not the current type.
 */

export type PersistedState = Record<string, unknown>;

/** The shape this build writes. Bump when a step is added. */
export const LEDGER_SCHEMA_VERSION = 1;

export interface Migration {
  /** The version this step produces. */
  to: number;
  /** Why it exists, in the user's terms. Surfaced in diagnostics. */
  reason: string;
  run: (state: PersistedState) => PersistedState;
}

function ledgerOf(state: PersistedState): PersistedState | null {
  const l = state.ledger;
  return l && typeof l === 'object' ? (l as PersistedState) : null;
}

export const MIGRATIONS: Migration[] = [
  {
    to: 1,
    reason:
      'Builds 0.13 and 0.14 stamped sslBasis:"salary" into every ledger before ' +
      'the basis meant anything. Left there it pins the limit to the salary ' +
      'cycle and stops a goal with a duration from steering. Clearing it ' +
      'restores automatic; a user who picks the salary cycle from now on keeps it.',
    run: (state) => {
      const led = ledgerOf(state);
      if (!led || led.sslBasis !== 'salary') return state;
      const { sslBasis: _dropped, ...rest } = led;
      return { ...state, ledger: rest };
    },
  },
];

/**
 * Brings a save forward to `LEDGER_SCHEMA_VERSION`.
 *
 * A save from the future — a phone that ran a newer build, then downgraded —
 * is returned untouched rather than mangled by steps that do not apply to it.
 * Losing a field this build cannot read is far better than corrupting one it
 * can.
 */
export function migrateState(state: unknown, from: number): PersistedState {
  if (!state || typeof state !== 'object') return {} as PersistedState;
  let out = state as PersistedState;
  for (const m of MIGRATIONS) {
    if (m.to > from) out = m.run(out);
  }
  return out;
}

/** The steps a save at `from` would run, for logs and diagnostics. */
export function pendingMigrations(from: number): Migration[] {
  return MIGRATIONS.filter((m) => m.to > from);
}
