import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardClaimBreakdown } from '../../src/components/CardClaim';
import { DailyLoopCard } from '../../src/components/DailyLoop';
import { SpendPlanCard } from '../../src/components/SpendPlanCard';
import { QuickAdd } from '../../src/components/QuickAdd';
import { QuickAction } from '../../src/components/Tiles';
import { Body, Button, Caption, Card, Meter, Row, Screen, Title } from '../../src/components/ui';
import { formatShortDate } from '../../src/i18n';
import { useLocalization, usePalette, useSafeSpend } from '../../src/store/selectors';
import { useLedger } from '../../src/store/useLedger';
import { forecast, forecastFromLedger, spendLadder, steeringGoal } from '../../src/domain';
import { FONT, SPACE } from '../../src/theme/tokens';
import { version as APP_VERSION } from '../../package.json';

/**
 * Home — the Safe Spend Limit.
 *
 * One number dominates the screen because one number is the product: how much
 * can I spend today without falling behind. Everything else is supporting
 * evidence, and the breakdown is collapsed by default so the answer is not
 * buried under the arithmetic that produced it.
 */
export default function HomeScreen() {
  const c = useSafeSpend();
  const { t, money, num, rtl, lang } = useLocalization();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [showHow, setShowHow] = useState(true);
  const [showCard, setShowCard] = useState(false);
  const [adding, setAdding] = useState(false);

  const ledger = useLedger((s) => s.ledger);
  const seedObligations = useLedger((s) => s.seedObligations);
  // The goal steering the plan, read from the engine's funded goals so its
  // progress matches what the plan was built from.
  const steeringGoalNow = steeringGoal(c.goals);

  // Two months is all Home needs: this one, and the one the next salary opens.
  const ahead = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const plannedCommitments = ledger.commits
      .filter((k) => !k.paused)
      .reduce((a, k) => a + (k.amt ?? 0), 0);
    const plannedTransfers = ledger.planTf.reduce((a, tf) => a + tf.amt, 0);

    return forecast(
      forecastFromLedger(
        ledger,
        {
          bank: c.bank,
          cash: c.cash,
          commitObl: c.commitObl,
          planT: c.planT,
          cardDue: c.cardDue,
          cardNextBill: c.cardClaim.billNext,
          goalReq: c.goalReq,
          livingPool: c.livingPool,
          cycleSpend: c.cycleSpend,
          daysLeft: c.daysLeft,
          daysInMonth,
        },
        plannedCommitments,
        plannedTransfers,
      ),
      2,
      now,
    );
  }, [ledger, c]);

  // The limit is the headline, but an overspent day needs to say so plainly
  // rather than just showing zero.
  const over = c.overToday > 0;
  const headlineColor = over ? p.negative : p.accent;

  // How much of today's allowance is gone. Guarded against a zero allowance,
  // which happens whenever the cycle is fully spent.
  const usedRatio = c.allowance > 0 ? c.flexToday / c.allowance : 1;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + SPACE.lg, paddingBottom: SPACE.xxl },
        ]}
      >
        {/*
          An empty commitment list is not "nothing is owed" — it is the salary
          reporting itself as entirely free while the goal quietly absorbs the
          rent. Stated before any number that depends on it.
        */}
        {ledger.commits.length === 0 && (
          <Card>
            <Title style={{ color: p.warn }}>{t('obMissingT')}</Title>
            <Caption>{t('obMissingB')}</Caption>
            <View style={{ marginTop: SPACE.md }}>
              <Button
                label={t('obMissingBtn')}
                onPress={() => {
                  seedObligations();
                  Alert.alert(t('obMissingT'), t('obMissingDone'));
                }}
              />
            </View>
          </Card>
        )}

        <Card>
          <Caption>{t('ssl')}</Caption>
          <Text style={[styles.hero, { color: headlineColor, textAlign: rtl ? 'right' : 'left' }]}>
            {money(c.ssl)}
          </Text>

          {over ? (
            <Body style={{ color: p.negative }}>
              {t('overLimit')} {money(c.overToday)}
            </Body>
          ) : (
            <Caption>
              {c.basis === 'goal'
                ? t('basisGoalHint')
                : c.basis === 'balance'
                  ? t('basisBalanceHint')
                  : t('sslDesc')}
            </Caption>
          )}

          <View style={{ marginTop: SPACE.md }}>
            <Meter ratio={usedRatio} color={over ? p.negative : p.accent} />
            <View style={[styles.meterLabels, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
              <Caption>
                {t('todaySpend')}: {money(c.flexToday)}
              </Caption>
              <Caption>{money(c.allowance)}</Caption>
            </View>
          </View>

          <View style={{ marginTop: SPACE.lg }}>
            <Button label={t('sslHow')} variant="secondary" onPress={() => setShowHow((v) => !v)} />
          </View>

          {showHow && (
            <View style={{ marginTop: SPACE.md }}>
              <Caption>{t('salaryAllocNote')}</Caption>

              {/* Claims on the salary, largest structural ones first. */}
              <View style={{ marginTop: SPACE.sm }}>
                <Row
                  label={c.basis === 'balance' ? t('allocLiquid') : t('salaryWork')}
                  value={money(c.basis === 'balance' ? c.liquid : ledger.base)}
                />
                <Row
                  label={t('upcoming')}
                  value={`− ${money(c.commitObl)}`}
                  onPress={() => router.push('/(tabs)/plan')}
                />
                {c.commitments.needsConfirm > 0 && (
                  <Caption style={{ color: p.warn, marginTop: SPACE.xs }}>
                    {t('cmNeedsConfirm').replace('{n}', num(c.commitments.needsConfirm))}
                  </Caption>
                )}
                <Row label={t('plannedTransfers')} value={`− ${money(c.planT)}`} />
                <Row
                  label={t('cardDueLabel')}
                  value={`− ${money(c.cardDue)}`}
                  valueColor={c.cardDue > 0 ? p.negative : p.sub}
                  onPress={() => setShowCard((v) => !v)}
                />

                {/*
                  The card is the one line nobody believes on sight, so its
                  parts expand in place rather than sending the user to another
                  screen to reconcile from memory.
                */}
                {showCard && (
                  <View
                    style={{
                      marginTop: SPACE.sm,
                      marginBottom: SPACE.sm,
                      paddingHorizontal: SPACE.md,
                      paddingVertical: SPACE.sm,
                      borderRadius: 12,
                      backgroundColor: p.faint,
                    }}
                  >
                    <CardClaimBreakdown claim={c.cardClaim} compact />
                  </View>
                )}

                {c.bufferReq > 0 && (
                  <Row
                    label={t('bufT')}
                    value={`− ${money(c.bufferReq)}`}
                    valueColor={p.accentDeep}
                    onPress={() => router.push('/floor')}
                  />
                )}
                <Row
                  label={t('goals')}
                  value={`− ${money(c.goalReq)}`}
                  onPress={() => router.push('/goal-plan')}
                />
                {c.goalHeldBack > 0 && (
                  <Caption style={{ color: p.warn, marginTop: SPACE.xs }}>
                    {t('heldBackByFloor')} {money(c.goalHeldBack)} — {t('floorProtected')}
                  </Caption>
                )}
                <Row label={t('livingPool')} value={money(c.livingPool)} valueColor={p.ink} />
                <Row label={t('monthSpend')} value={`− ${money(c.cycleSpend)}`} />
                <Row
                  label={t('remainingCycle')}
                  value={money(Math.max(0, c.spendable))}
                  valueColor={c.spendable > 0 ? p.positive : p.negative}
                />
                <Row label={t('daysLeftLabel')} value={`÷ ${num(c.daysLeft)}`} />
              </View>

              {c.cardClaim.billNext > 0 && (
                <View style={{ marginTop: SPACE.lg }}>
                  <Row
                    label={t('cardNextBillL')}
                    value={money(c.cardClaim.billNext)}
                    valueColor={p.warn}
                  />
                  <Caption style={{ marginTop: SPACE.xs }}>{t('cardNextBillNote')}</Caption>
                </View>
              )}

              <Caption style={{ marginTop: SPACE.md }}>{t('sslNote')}</Caption>
            </View>
          )}
        </Card>

        {/*
          On the goal basis the plan IS the answer, so it leads. The salary
          breakdown below still explains where the pool came from, but the
          number to act on is the plan's, not a residual.
        */}
        {/* The loop's reading leads: it is the only part of the screen that
            reacts to what actually happened today. */}
        {c.daily != null && (
          <DailyLoopCard
            daily={c.daily}
            band={c.band}
            target={c.targetAdapted}
            goal={steeringGoalNow}
          />
        )}

        {c.plan != null && steeringGoalNow != null && (
          <SpendPlanCard
            plan={c.plan}
            goal={steeringGoalNow}
            projectedAtPace={c.planProjected}
            landing={c.targetAdapted?.adapted ?? c.plan.projected}
            ladder={
              c.planInputs != null ? spendLadder(steeringGoalNow, c.plan, c.planInputs) : []
            }
          />
        )}

        {/*
          The build stamp, on the first screen rather than four taps into
          settings. When an update "did not arrive", this is the single fact
          that separates a code problem from a stale bundle on the device —
          and it costs one line to never have to guess again.
        */}
        <Caption style={{ textAlign: rtl ? 'left' : 'right', opacity: 0.6 }}>
          v{APP_VERSION}
        </Caption>

        {/*
          An installment balance with no monthly charge is the one case where
          the limit is knowably too high and the app cannot fix it alone. It
          gets its own card on Home rather than a line in the breakdown,
          because a number that is wrong for a known reason should not be
          discoverable only by expanding a section.
        */}
        {c.cardClaim.installmentUnknown && (
          <Card>
            <Title style={{ color: p.warn }}>{t('instUnknownT')}</Title>
            <Caption>{t('instUnknownB')}</Caption>
            <View style={{ marginTop: SPACE.sm }}>
              <Row
                label={t('cardDeferredRow')}
                value={money(c.cardClaim.installmentBalance)}
                valueColor={p.warn}
              />
            </View>
            <View style={{ marginTop: SPACE.md }}>
              <Button label={t('setInstMoBtn')} onPress={() => router.push('/card')} />
            </View>
          </Card>
        )}

        <Card>
          <Title>{t('availNow')}</Title>
          <Caption>{t('confirmedOnly')}</Caption>
          <View style={{ marginTop: SPACE.sm }}>
            <Row label={t('bankAcct')} value={money(c.bank)} />
            {c.cash != null && <Row label={t('cashAcct')} value={money(c.cash)} />}
            <Row
              label={t('cardOut')}
              value={money(c.cc.out)}
              valueColor={p.negative}
              onPress={() => router.push('/card')}
            />
            <Row
              label={t('tomorrowLabel')}
              value={money(c.tomorrow)}
              valueColor={c.tomorrow >= c.allowance ? p.positive : p.warn}
            />
          </View>

          {/*
            Where the balance actually ends up, on the first screen rather than
            two taps away. Both figures come from the same forecast the
            dedicated screen uses, so they cannot disagree with it.
          */}
          {ahead.length > 0 && (
            <View style={{ marginTop: SPACE.lg }}>
              <Row
                label={t('expEndMonth')}
                value={money(ahead[0]?.closing ?? 0)}
                valueColor={(ahead[0]?.closing ?? 0) < 0 ? p.negative : p.ink}
                onPress={() => router.push('/forecast')}
              />
              {ahead[1] != null && (
                <Row
                  label={t('expAfterSalary')}
                  value={money(ahead[1].closing)}
                  valueColor={ahead[1].closing < 0 ? p.negative : p.positive}
                  onPress={() => router.push('/forecast')}
                />
              )}
              <Caption style={{ marginTop: SPACE.xs }}>{t('expNote')}</Caption>
            </View>
          )}
        </Card>

        <Card>
          <Title>{t('nextIncome')}</Title>
          <Body muted>
            {formatShortDate(c.nextPay, lang)} · {num(c.daysLeft)} {t('dayW')}
          </Body>
        </Card>

        {/* Adding a spend lives in the floating button, which is reachable from
            every screen and never scrolls away — so this row is for the two
            things worth a deliberate trip. */}
        <QuickAction icon="🎯" label={t('goalPlanT')} primary onPress={() => router.push('/goal-plan')} />
        <View style={{ height: SPACE.sm }} />
        <QuickAction icon="📊" label={t('insights')} onPress={() => router.push('/insights')} />
      </ScrollView>

      <QuickAdd visible={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACE.lg },
  hero: { fontSize: FONT.hero, fontWeight: '800', marginVertical: SPACE.sm },
  meterLabels: { justifyContent: 'space-between', marginTop: SPACE.sm },
});
