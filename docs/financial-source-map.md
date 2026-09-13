# Financial source map

Which code produces which number, and where the contract in
`financial-contract.md` is currently broken.

Written 2026-09-13, against commit `6597ab5`.
Baseline at that commit: **`tsc --noEmit` clean, 532/532 tests passing across
26 files, working tree clean.**

> Note on the external review: it reports 530 passing and 2 failing in
> `src/domain/goalPlan.test.ts`. That run was against a local working tree
> holding ~30 modified and ~19 untracked files that are not in this
> repository. At this commit the suite is green. The findings below were each
> re-verified against this tree; those that no longer apply are marked so.

---

## 1. Layers

```
screens (app/**)            read only from the domain barrel and the store
  └── src/store/selectors   view-model glue, no arithmetic of its own
       └── src/domain       pure, clock-injected, tested
            └── src/lib     storage, Supabase, notifications — no arithmetic
```

`src/domain/index.ts` re-exports every module, so every screen imports from one
barrel. That is why the import lists below are the honest surface: there is no
back channel.

## 2. Screen → domain functions

| Screen | Domain functions it reads |
|---|---|
| `app/(tabs)/index.tsx` (Home) | `forecast`, `forecastFromLedger`, `spendLadder`, `steeringGoal` (+ `safeSpend` via selectors) |
| `app/(tabs)/plan.tsx` | `commitmentsDue`, `drawsFromBalance`, `heldFor`, `debtSummary`, `goalMonthlyRequirement`, `personHistory`, `repaidRatio` |
| `app/(tabs)/calendar.tsx` | `isPaidFor` |
| `app/(tabs)/transactions.tsx` | classification helpers |
| `app/goal-plan.tsx` | `goalPlan`, `goalScenarios`, `adaptiveOutlook`, `adaptTarget`, `requirementFor` |
| `app/insights.tsx` | `analyticsReadiness`, `burnRate`, `categoryStats`, `detectRecurring`, `goalProjection`, `merchantStats`, `monthComparison`, `safeSpend`, `savingSummary`, `underLimitStreak` |
| `app/forecast.tsx` | `forecast`, `forecastFromLedger` |
| `app/floor.tsx` | `recommendFloor`, `recommendBuffer` |
| `app/transfers.tsx` | `transferStats`, `transferSummary`, `annualFeeCost` |
| `app/salary.tsx` | `overtimeTotal` |
| `app/card.tsx`, `app/receivables.tsx`, `app/start-today.tsx` | input parsing only |
| `src/components/SpendPlanCard.tsx` | renders `SpendPlan` |
| `src/components/GoalFeasibility.tsx` | renders `Projection` |
| `src/components/CardClaim.tsx` | `cardClaim` |
| `src/components/ExportBackup.tsx` | `buildBackup`, `backupToText`, `summarizeBackup` |
| `src/components/RestoreBackup.tsx` | `parseBackup` |

## 3. Function → responsibility

**Balances.** `balances.ts` — `posts`, `bankBalance`, `cashBalance`. The single
authority on how each `TxType` moves an account.

**Card.** `card.ts` — `cardPosition`, `cardCarryover`, `cardClaim`,
`instBilled`, `instPaidOff`, `amortizedInstBal`, `monthsElapsed`. Payment
waterfall: statement → billed installments → unbilled. `cardClaim` is
auditable: `chargedThisMonth + deferred === totalOwed`.

**Commitments.** `commitments.ts` — `cycleKey`, `isPaidFor`,
`commitmentStatus`, `commitmentsDue`. `paidFor` ('YYYY-MM') supersedes the
never-cleared `paidMonth`.

**Variance.** `variance.ts` — `commitmentActual`, `transferActual`,
`varianceReport`. Planned minus actual, flowing to the goal in both
directions.

**Projection — the current authority.** `projection.ts` — `netPosition`,
`simulate`, `assess`, `project`, `dailyBudget`. Month-by-month to the goal's
date. Month 0 charges `income: 0` (the salary has already landed),
`commitments: due.total` with settled lines excluded, and the remaining
transfers.

**Safe spend.** `safeSpend.ts` — `safeSpend`, `savingSummary`. Delegates the
daily figure to `dailyBudget` when a living band exists. Owns the one canonical
goal contribution, `goalMonthly = goalRequired + bankedToGoal + variance.toGoal`.

**Forecast.** `forecast.ts` — `forecast`, `forecastFromLedger`. Month-by-month
bank balance. The goal is an earmark and is deliberately absent from the
closing-balance line.

**Floor.** `floor.ts` — `dailyTotals`, `percentile`, `trimmedMean`,
`spendProfile`, `recommendFloor`, `recommendBuffer`. `MIN_DENSITY = 0.4`.

**Readiness.** `readiness.ts` — `analyticsReadiness`, gating merchants,
categories, weekday, month-compare and recurring detection.

**Funding.** `funding.ts` — `drawsFromBalance`, `fundGoals`, `heldFor`,
`fundedGoal`, `fundedGoals`.

**Legacy / pre-projection.** `adaptive.ts`, `adaptiveDaily.ts`, `goalPlan.ts`,
`spendPlan.ts` all still compute goal-facing figures. They predate
`projection.ts` and are the reason more than one function can answer the same
question. Consolidating them is Phase 2.

## 4. Defect register

Each entry was re-verified against this tree.

### D1 — A cloud pull destroys data. *(confirmed, severity: critical)*

`src/lib/sync.ts:264,285,297,311` — `pullLedger` builds the incoming ledger
with `otEntries: []`, `recv: []`, `planTf: []`, `rules: {}`. It also never sets
`cardAdjNote`, `Commitment.actual`, `Tx.commitId`, `Tx.back`, `baseline`,
`minDailySpend`, `comfortDailySpend`, `bufferTarget` or `goalMode` — they are
optional on `Ledger`, so TypeScript accepts their absence silently.

`pushLedger` never sends those fields either, so the remote has never held
them. The result is not a stale value but an erasure: pulling replaces local
state, so overtime history, receivables, the planned transfer and the learned
categorisation rules are gone.

Losing `Tx.commitId` is worse than losing a field. It breaks §5 of the
contract: a settled rent transaction that comes back without its `commitId` is
counted as discretionary spending **and** its commitment is charged again.

### D2 — Persistence is unversioned. *(confirmed, severity: high)*

`src/store/useLedger.ts:593` — the persist config has a `name` and a custom
`merge`, but **no `version` and no `migrate`**. Schema changes are handled by
ad-hoc code inside `merge` (currently one `sslBasis` fix-up). There is no way
to know which build wrote a save, and no ordered migration chain.

### D3 — Backup is write-complete but read-lossy. *(partially confirmed)*

`exportBackup.ts` writes whole objects, so `Commitment.actual`,
`PlannedTransfer.sentFor`, `Tx.commitId`, `Tx.back` and `cardAdjNote` do
survive **export**. The review's claim that export drops them does not apply
here. What is unproven is the **import** side: `importBackup.ts` re-maps field
by field and there is no round-trip test over a ledger that exercises every
optional field. Phase 1 adds one.

### D4 — Onboarding writes obligations the user never entered. *(confirmed, severity: high — trust)*

`app/onboarding.tsx:80,87` — every new ledger is seeded with Rent 1800,
Internet 300 and a planned transfer of 850, after the preview and regardless of
what was entered. These are the author's own figures. This breaks §11: the
first thing a new user sees is someone else's rent presented as their own.

### D5 — More than one function answers the same question. *(confirmed, severity: medium)*

`projection.ts:346` duplicates the goal-selection rule that
`spendPlan.ts:208` already owns as `steeringGoal`. They agree today, which is
exactly why the duplication is dangerous: nothing forces them to keep agreeing,
and `goalPlan.ts`, `adaptive.ts` and `adaptiveDaily.ts` each still project the
goal on their own terms.

The selected-goal problem is real but narrower than reported: both functions
take the **first** goal with a positive target and a positive duration, while
`app/goal-plan.tsx` renders whichever goal the user is looking at. With more
than one such goal, the headline and the detail describe different goals.

### D6 — Web build artefact. *(not reproducible here)*

The review reports `dist/index.html` using `import.meta` without
`type="module"`. There is no `dist/index.html` in this tree — `dist/` holds
`_expo/`, `assets/` and `metadata.json` from a native export. Re-check after a
web export before acting.

### D7 — Duplicate Android permissions. *(not reproducible here)*

`app.json:47-52` declares four permissions, each once, plus a
`blockedPermissions` list. No duplication at this commit.

## 5. Order of work

Data protection first, then import/sync, then the engine, then the screens —
D1 and D2 can destroy a user's records, and no amount of correct arithmetic
above them matters if the records underneath are gone.

1. **Phase 1** — D2, D1, D3
2. **Phase 2** — D5 (one engine, strangler pattern)
3. **Phase 3** — occurrences, statement lifecycle, cycle rollover
4. **Phase 4** — selected-goal identity, analytics
5. **Phase 5** — D4
6. **Phase 6** — D6, D7, artefact hygiene
