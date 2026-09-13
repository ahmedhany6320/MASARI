# مصاري — Masari

An Arabic-first personal finance app built around one question: **how much can I
safely spend today?**

Masari answers it with the Safe Spend Limit — a daily figure derived from the
salary cycle rather than the bank balance, because day-to-day spending runs on a
credit card while the bank balance is goal capital.

```
livingPool = salary − commitments − planned transfers − goal contributions
spendable  = livingPool − spent so far this cycle
allowance  = (spendable + spentToday) / daysToPayday
ssl        = allowance − spentToday
```

`spentToday` is added back before dividing and subtracted after, so today's
allowance is computed as though the day had not started — otherwise every
purchase would shrink the same day's own budget twice.

## Status

This is a rewrite of the original prototype (preserved in `legacy-pwa/`) as a
real Expo / React Native app. What is built:

- **Domain engine** — balances, credit-card position, goals, overtime, the safe
  spend limit and monthly saving. Pure TypeScript, 77 unit tests.
- **Screens** — onboarding, Home (safe spend limit), Plan (commitments, budgets,
  people, goals), Transactions, Calendar, More.
- **Persistence** — offline-first on-device storage; the app is fully usable
  with no account and no network.
- **Supabase schema** — per-user tables with row-level security.

Not yet wired up: the sync client that talks to the schema, push notifications,
biometric unlock enforcement, and the international-transfer screens.

## Running it

```bash
npm install
npx expo start        # then scan the QR with Expo Go
```

Native builds (needed for background notifications, which is the whole reason
this is not a PWA):

```bash
npx expo run:android
npx expo run:ios      # requires macOS
```

## Tests

The domain layer is where the money math lives, so it is the part with real
coverage:

```bash
npm test          # vitest, 77 tests
npm run typecheck # tsc --noEmit
```

## Architecture

```
src/domain/    Pure money math. No React, no Expo, no I/O, no clock reads —
               callers inject `now`. This is what makes it testable, and it
               can be lifted to a server or a web build unchanged.
src/i18n/      AR/EN string tables. `en.ts` is typed against `ar.ts`, so an
               untranslated key fails the build instead of rendering
               `undefined` to the user.
src/theme/     Semantic design tokens carried over from the prototype's CSS.
src/store/     Zustand store + selectors binding the store to the engine.
src/lib/       Supabase client.
app/           Expo Router screens.
supabase/      SQL migrations.
```

**No derived figure is ever stored.** Balances, the card position and the safe
spend limit are always recomputed from the transaction list, so they cannot
drift out of sync with the entries behind them.

## Configuration

Masari runs fully offline with no setup. To enable cloud sync, copy
`.env.example` to `.env.local` and fill in your Supabase project URL and anon
key, then apply `supabase/migrations/0001_init.sql`.

Both values are safe to ship in a client build — the anon key is designed to be
public, and row-level security is what protects the data. **Never** put the
service-role key in the app; it bypasses RLS entirely.

### A note on the prototype's sync

The original stored the entire ledger as a single row keyed by a short "sync
code", readable by anyone holding that code plus the public anon key. The schema
here replaces that: every row carries a `user_id`, and RLS policies make the
database enforce that a user can only reach their own rows. The client is not
trusted to filter.

## Legacy prototype

`legacy-pwa/` holds the original single-file PWA. It is kept as the reference
for behaviour and wording — the domain engine was ported from it function by
function — but it is not part of the build.
