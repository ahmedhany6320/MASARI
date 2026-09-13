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

**The front door.** `domain/engine.ts` exports `evaluateFinancialState(ledger,
asOf, options)`. It is not a rewrite — it forwards to `safeSpend` and carries
its whole result as `detail` — but it is the one place the contract is
enforced rather than described. It guarantees a single goal identity, a single
daily figure and a single monthly goal contribution, and it returns
`consistency`: the relationships the contract requires, re-derived from the
outputs. The tests assert that list is empty, and separately assert that
corrupting any one figure makes the matching rule fire, so the harness cannot
quietly become a no-op. Screens migrate onto it one at a time; Home is the
first.

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

### D4 — Onboarding wrote obligations the user never entered. *(confirmed, severity: high — trust; fixed in Phase 5)*

Every new ledger was seeded with Rent 1,800, Internet 300 and a planned
transfer of 850, after the preview and regardless of what was entered. Those
are the author's own figures, so a stranger's first view of the app was
someone else's rent presented as their own.

It was worse than a wrong default. The preview above the button subtracted
only what the user had typed, so the very first number the app produced was
one it contradicted a second later — and the Home banner offering to "add my
commitments" inserted the same three figures silently.

Onboarding now asks for rent, internet, a monthly transfer and anything else
as named fields; a blank field writes nothing, and the preview subtracts
exactly what will be saved. The banner navigates to Plan instead of inserting
anything. `DEFAULT_COMMITMENTS`, `DEFAULT_PLANNED_TRANSFER` and
`seedObligations` are deleted, so those figures no longer exist anywhere in
the app. `onboarding.test.ts` asserts the absence — including by serialising a
fresh ledger and failing on any non-zero amount at all — because absence is
what silently comes back.

### D5 — More than one function answers the same question. *(confirmed, severity: HIGH — worse than first assessed; addressed in Phase 2)*

`projection.ts:346` duplicates the goal-selection rule that
`spendPlan.ts:208` already owns as `steeringGoal`. They agree today, which is
exactly why the duplication is dangerous: nothing forces them to keep agreeing,
and `goalPlan.ts`, `adaptive.ts` and `adaptiveDaily.ts` each still project the
goal on their own terms.

The selected-goal problem is real but narrower than reported: both functions
take the **first** goal with a positive target and a positive duration, while
`app/goal-plan.tsx` renders whichever goal the user is looking at. With more
than one such goal, the headline and the detail describe different goals.
That part is Phase 4.

**What measurement found, which was worse.** `safeSpend` was running two
plans side by side and rendering both. The daily allowance came from
`projection`; the monthly goal contribution came from `spendPlan`; the banked
underspend came from `adaptDaily`, which had computed a third daily figure of
its own. On the real August ledger, at one instant:

| Figure | Value | Source |
|---|---|---|
| Daily allowance shown | 50.37 | `projection` → `dailyBudget` |
| Daily figure behind the goal credit | 254.30 | `adaptDaily` |
| Daily figure the plan assumed | 190.72 | `spendPlan` |
| Monthly goal contribution reported | 4,345.86 | `spendPlan` + `adaptDaily` |
| Monthly goal implied by the shown daily figure | 9,800 | `projection` |

Living at 50 a day for a month is 1,200 against a capacity of 11,000 — so the
screen showing 4,346 and the screen showing 50 were describing different
months, and the goal was being credited with savings measured against a plan
the app had stopped showing.

**Fixed in Phase 2.** The projection is now the sole authority for both. The
goal takes what the month does not spend, capped at what its own schedule
asks for, and what remains above that is reported as a named `surplus`
instead of silently inflating the goal. `goalMonthly` is measured against the
daily figure actually in force and now subtracts `goalAbsorbed` — honouring
the living floor in an overspent month costs the goal real money, and only
the credit was ever reported.

### D6 — The web build served a blank page. *(CORRECTION: reproduces; fixed in Phase 6)*

Recorded in Phase 0 as "not reproducible". That was wrong, and the reason is
worth keeping: the `dist/` in this tree held a **native** export, so there was
no `index.html` to look at. Running an actual web export reproduces it exactly
as reported.

`expo export --platform web` emits `<script defer>` — a classic script, not a
module. Zustand's middleware module ships a devtools helper reading
`import.meta.env.MODE`; this app never uses devtools, but Metro does not
tree-shake, so the expression is in the bundle. `import.meta` inside a classic
script is a **syntax** error, thrown at parse time, so the entire bundle fails
to execute and nothing in the console points at any line of this app's code.

Fixed with a Babel plugin in `babel.config.js` that rewrites `import.meta` to
an empty object, which makes every guarded read of `import.meta.env` take its
production fallback. Verified: zero occurrences in the web bundle after the
change, and the Android bundle is unchanged in size and still exports.

One wrinkle worth recording — adding a `babel.config.js` at all changes preset
resolution. `babel-preset-expo` is not a direct dependency (Expo resolves it
internally when no config exists) and in this tree it is nested under
`expo/node_modules`, so naming it by bare string fails outright. The config
resolves it through `expo`'s own directory instead.

### D7 — Duplicate Android permissions. *(not reproducible here)*

`app.json:47-52` declares four permissions, each once, plus a
`blockedPermissions` list. No duplication at this commit. Re-checked in
Phase 6 after the D6 correction, in case it was the same kind of mistake: it
is not — there is genuinely nothing to fix.

### `legacy-pwa/` — purpose confirmed, keeping it

The original single-file PWA prototype, 903 KB of it. `README.md` names it as
the reference implementation, `tsconfig.json` excludes it from the build, and
it is the source of the backup format both the importer and the exporter are
written against. It is documentation with a behavioural spec inside it, not a
stale artefact. Left in place.

### D8 — Flags with no cycle attached. *(found in Phase 3, severity: high)*

The lesson `paidMonth` taught was not applied everywhere. Two more fields had
the same shape and one figure had no month at all.

`salStatus` / `salActual` carried no cycle. Marking September's salary
received left the app asserting every later salary had landed too, so the
prompt to confirm it vanished permanently after the first month, and one
overtime-boosted month's `salActual` went on inflating every month after it.
Fixed with `salFor`, stamped exactly as `paidFor` is, read through
`salaryCycle()`.

`overtimeTotal(ledger.otEntries)` summed every entry ever recorded and the
salary screen presented the total as this month's overtime, so a good June was
still being added to the expected salary in December. Fixed with
`overtimeThisCycle()`; the lifetime total remains available under its own name.

### D9 — The statement and due days were collected and never used. *(found in Phase 3, severity: medium)*

`cardCfg.closeDay` and `cardCfg.dueDay` are asked for on the card screen,
stored, validated and displayed — and no calculation anywhere read either. The
money was not wrong: `cardPosition` accounts for every dirham and
`cardCarryover` separates what this cycle has counted from what it carried in.
What was missing is *when*.

It matters because the statement boundary is not the salary boundary. With a
statement closing on the 3rd, a purchase on the 1st is on the statement that
has already closed, while the salary cycle counts it as this month's. Treating
them as the same date is correct only when the card closes on the 1st, which
is a default rather than a fact.

`statement.ts` derives the period, the close, the due date and what the closed
statement actually demands. The card screen now shows it.

### D10 — A commitment's history was one month deep. *(found in Phase 3, severity: medium)*

`paidFor` and `actual` describe a single cycle and are overwritten by the next
one. Settling October's rent erased September's, so the month a bill came in
under plan — and the money that sent to the goal — stopped being answerable
the moment the next month was ticked.

`Commitment.history` is the series; `recordSettlement` appends to it and
corrects rather than duplicating a cycle already recorded, since two
settlements for one month would hand the goal the same variance twice. The
single-cycle fields are kept in step so nothing reading them changed and an
older build still loads the save.

### D11 — Three definitions of "spending". *(found in Phase 4, severity: high)*

The daily limit counted posted expenses excluding commitment settlements. The
floor recommender counted posted expenses *including* them. Insights counted
every expense row including the non-posting ones already baked into the
opening balance — despite a comment there claiming otherwise.

Two of those produced visibly wrong numbers:

- `burnRate` projected the month from a total containing the rent and compared
  it against `livingPool`, which has the rent taken out. It therefore announced
  an overrun roughly the size of the rent, every month, from the 1st.
- `recommendFloor` read a percentile of daily totals with the rent in them, so
  it proposed a living floor inflated by a bill that is not living — and the
  difference came straight out of the goal.

`classify.ts` now owns the definition: `isDiscretionary` (what a daily limit
governs), `isOutgoing` (every expense that moves money), `counts` (posts at
all). `safeSpend`, `floor` and `insights` all read it.

### D12 — The goal on screen was not the goal being steered. *(the rest of D5, fixed in Phase 4)*

`project()` wrote the steering-goal rule out for itself instead of calling
`steeringGoal`, so two functions chose independently — while `goal-plan.tsx`
rendered whichever goal the user had tapped and applied the *steering* goal's
monthly contribution to it. With more than one dated goal, the landing date
shown for goal B was computed from goal A's savings.

`steeringGoal(goals, preferredId)` is now the only place that rule lives.
`Ledger.steerGoalId` records an explicit choice and falls back to list order,
`SafeSpend.steering` exposes it so screens stop choosing again, and the goal
screen says plainly when what it is showing is not what the daily limit is
working toward. The chosen goal is also funded from the balance first —
steering by a goal the balance was starving is the opposite of choosing it.

### D13 — The projection could not see what the goal already held. *(found continuing Phase 2, severity: high)*

`safeSpend` resolves what actually backs each goal — an auto goal draws its
progress from the balance rather than from a typed figure — and then handed
`project()` the **raw** ledger, where that same goal's `alloc` is still zero.

So the projection assessed a goal holding 12,800 as holding nothing. It
demanded 1,634 a month where the goal needed 923 once its own savings were
counted, and reported it as further from its target than it was. Fixed by
passing the funded goals; `required-monthly` in the consistency harness now
holds the projection's requirement against the steering goal's own schedule.

### D14 — Capacity was guessed from what had been logged. *(found continuing Phase 2, severity: high)*

`useCapacity` built its own picture: a second `safeSpend` call at a second
clock reading, with the month's living estimated from `burnRate` — a
straight-line extrapolation of however much had been recorded so far.

On a ledger with two purchases logged that read as 193 a month against a
planned 1,200, so the goal screen announced **6,327 a month of saving where
the engine reserved 923**. Seven times over, on the headline figure of the
screen whose whole job is that number. It also meant recording lunch restated
what the month could put aside, which a plan must not do.

`SafeSpend.capacity` is now built once, from the projection's planned living
and the same post-reserve pool the goal reservation uses. Two consistency
rules hold it: capacity must equal pool minus living, and must split exactly
into the goal reservation plus the surplus.

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
