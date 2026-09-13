# The Masari financial contract

This is the accounting agreement the whole app is held to. Every screen,
selector and domain function is expected to obey it; where one does not, that
is a defect and it is recorded in `financial-source-map.md`.

Written 2026-09-13, against commit `6597ab5`.

---

## 1. Units and sign

- Every amount is a **positive magnitude** in AED unless the field explicitly
  says otherwise. Direction is carried by `Tx.type`, never by a negative
  number. The single exception is `adjust`, which is signed because a
  reconciliation can go either way.
- `Goal.target` for an EGP goal is denominated in EGP and converted at read
  time with the FX rate. Nothing else in the ledger stores EGP.
- Money is stored as a JavaScript number. Comparisons for equality must go
  through a tolerance, never `===`.

## 2. The three stores of value

| Thing | Where it lives | Sign |
|---|---|---|
| Bank | `bankOpen` + posted transactions | asset |
| Cash | `cashOpen` + posted transactions | asset, `null` until tracked |
| Credit card | `cardSetup` + card-account spending − payments | **liability** |

The credit card is never a balance. It is money already owed.

## 3. Net position — the device that stops double counting

```
netPosition = bank + cash − (statementRemaining + unbilled + installmentBalance)
```

This single figure is what makes a card purchase and the later card settlement
**one movement rather than two expenses**.

- Buying lunch on the card raises `unbilled`, so net position falls once, at
  the moment of the purchase.
- Paying the statement lowers `bank` and lowers `statementRemaining` by the
  same amount, so net position does **not** move. The money left the bank, but
  it was already owed; nothing new was consumed.

Any calculation that subtracts both the card spending and the card payment is
wrong by construction. This is the invariant to check first whenever a figure
looks too pessimistic.

## 4. Outflow versus earmark

An **outflow** leaves the user's control: rent, groceries, an international
transfer, a debt repayment.

An **earmark** is money still owned but spoken for: a goal allocation, a
buffer.

Forecasts and balance projections subtract outflows only:

```
closing = opening + salary − commitments − transfers − card − living
```

The goal does not appear. Subtracting it would report a balance the user does
not have and cannot spend, and it would fall again every month the goal grew.
`forecast.ts` is the authority on this and is tested for it.

## 5. Commitments are counted exactly once

A commitment line may be counted in **one** of these places per cycle, never
two:

1. **Pending** — not yet settled this cycle. It is a future obligation: it
   appears in `commitmentsDue.total` and is charged in the projection.
2. **Settled** — `settleCommitment` wrote a real `Tx` carrying `commitId`.
   From that moment the money is a recorded expense and the commitment is
   excluded from `commitmentsDue`.

Two rules follow, and both are enforced in `commitDupe.test.ts`:

- Any transaction with `commitId != null` is **excluded** from discretionary
  spending (`cycleSpend`, `flexToday`). It was already budgeted as an
  obligation; charging it again would punish the user for recording it.
- A paid flag is stamped with its cycle (`paidFor: 'YYYY-MM'`), so it expires
  by itself. September's rent is never charged in October, and October's rent
  is never suppressed by September's payment. The legacy boolean `paidMonth`
  is mirrored for old builds but is not authoritative.

Planned-versus-actual: the difference between `Commitment.amt` (the plan) and
the settled `actual` flows to the goal, in both directions. Underpaying gains
ground; overpaying loses it. Neither is silently absorbed.

## 6. The daily figure is an output, not an input

The order of derivation is fixed:

1. Project month by month to the goal's target date (`projection.simulate`).
2. Ask what is reachable at zero discretionary spending
   (`projection.assess` → `maxReachable`).
3. Compare against the goal to get a verdict: `feasible`, `unsustainable`,
   `impossible`, `met`, `unset`.
4. Only then derive today's allowance (`projection.dailyBudget`).

The daily number is never the starting point, and a goal is never met by
demanding a day the user cannot live on.

## 7. The living band is inviolable

`minDailySpend` is a floor, not a suggestion. When the arithmetic wants less
than the floor, the floor wins and the **goal slips** — visibly, with the
shortfall named. `comfortDailySpend` is the top of the band: what a normal day
costs rather than an endured one.

Underspend and overspend are absorbed by smoothing, not by a cliff:

```
alpha   = min(1, smoothingWindow / daysLeft)
today   = max(floor, planned + (strict − planned) × alpha)
```

Early in the month a miss is spread thin; near the end it bites, because there
is nowhere left to spread it. `absorbed` records what the floor refused to
take, so the shortfall is reported rather than hidden.

## 8. Variance is measured against completed days

Today is not elapsed until it is over. Measuring against `daysElapsed`
including today credits the user with a full day's saving every morning before
they have bought anything. Always `daysElapsed − 1`.

## 9. Recording density gates analytics

With 11 recorded days out of 91, a p25 of the daily totals is zero — not
because the user lived on nothing, but because they did not record. Statistics
are shown only when `spendProfile.density` clears `MIN_DENSITY` and the entry
counts clear their thresholds (`readiness.ts`). Below that the app says it does
not know yet, which is true and is better than a confident wrong number.

## 10. Persistence, backup and sync

These three are one contract, and it is currently broken (see the source map).

- **Persistence** must be versioned, with a migration chain. A save written by
  any shipped build must load, or be migrated, without losing a field.
- **Backup** must round-trip: export then import must reproduce a
  byte-identical ledger. A format that can only be written is not a backup.
- **Sync** must never lose a field the device holds. A pull that cannot carry a
  field must merge it from local state rather than blanking it. Last-write-wins
  is an accepted trade for conflicts; silent field loss is not.

## 11. One projector, and no spares

Exactly one place answers "where does this goal land, and what does that cost
per day": the simulation in `projection.ts`, reached through
`evaluateFinancialState`. Anything else that wants the answer reads it.

This is a rule about **dead code as much as live code**. Five exported
functions — `reserveForGoal`, `adaptiveHorizon`, `dailyForTarget`, `planDrift`,
`horizonTracker` — plus `projectGoal` and a whole second daily control loop in
`adaptDaily` each independently answered some version of that question, and
none of them had a caller left. They were reached only by their own tests.

That is not harmless. A spare projector sitting in the domain is the next
divergence, waiting for someone to reach for it because it is right there and
reads correctly — which is precisely how this app came to print 433,894,
409,958, 407,261, null and NaN for one question, two of them on the same
screen. All of them are deleted.

If a new question genuinely needs a different model, it goes in
`projection.ts` beside the existing one, where the consistency harness in
`engine.ts` can hold the two against each other.

## 12. Defaults are the user's, not the author's

No figure the user did not enter or explicitly accept may be written into their
ledger. A seeded obligation must be shown, named and confirmed before it is
saved. An app that invents someone else's rent is wrong even when the number
happens to be right.
