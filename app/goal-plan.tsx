import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips, Sheet, TextField } from '../src/components/fields';
import { Body, Button, Caption, Card, Meter, Row, Screen, Title } from '../src/components/ui';
import {
  adaptiveOutlook,
  formatAmount,
  goalPlan,
  goalScenarios,
  horizonTracker,
  isEgpGoal,
  parseAmount,
  projectGoal,
  requirementFor,
  type GoalMode,
} from '../src/domain';
import { MONTHS } from '../src/i18n';
import { useCapacity, useLocalization, usePalette, useSafeSpend } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { FONT, RADIUS, SPACE } from '../src/theme/tokens';

const HORIZONS = [6, 8, 12, 18, 24, 36] as const;

/**
 * Goal plan — the screen that answers "am I actually going to get there".
 *
 * Ordered as a conversation rather than a dashboard:
 *   where I stand → where this pace lands me → why not sooner →
 *   what a deadline would cost → pick one.
 *
 * The design rule throughout is that no number appears without the sentence
 * that makes it actionable. "You will not make it" was true and useless; "even
 * spending nothing, 8 months reaches 96% — 10 months is the realistic plan" is
 * the same maths made usable.
 */
export default function GoalPlanScreen() {
  const p = usePalette();
  const { t, lang, money, num, rtl } = useLocalization();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();

  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);
  const updateGoal = useLedger((s) => s.updateGoal);
  const setMinDailySpend = useLedger((s) => s.setMinDailySpend);
  const setGoalMode = useLedger((s) => s.setGoalMode);
  const capacity = useCapacity();
  const spend = useSafeSpend();

  const minDaily = ledger.minDailySpend ?? 0;

  /*
   * Read from the engine's funded goals, not from the raw ledger. `alloc` on
   * the raw record is zero for any goal drawing from the balance, which is
   * what made this screen report "0 saved" against a funded account.
   */
  const goals = spend.goals.filter((g) => g.target != null);
  const [selectedId, setSelectedId] = useState<string | null>(params.id ?? goals[0]?.id ?? null);
  const goal = goals.find((g) => g.id === selectedId) ?? goals[0] ?? null;

  const [horizon, setHorizon] = useState<number>(12);
  const [editing, setEditing] = useState(false);
  const [targetDraft, setTargetDraft] = useState('');
  const [floorSheet, setFloorSheet] = useState(false);
  const [floorDraft, setFloorDraft] = useState('');

  const now = useMemo(() => new Date(), []);

  if (!goal) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={{ padding: SPACE.lg, paddingTop: insets.top + SPACE.lg }}>
          <Button label={t('back')} variant="secondary" onPress={() => router.back()} />
          <View style={{ height: SPACE.lg }} />
          <Card>
            <Title>{t('goals')}</Title>
            <Body muted>{t('goalsEmpty')}</Body>
            <View style={{ marginTop: SPACE.md }}>
              <Button label={t('addGoal')} onPress={() => router.push('/(tabs)/plan')} />
            </View>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  const egp = isEgpGoal(goal);
  const cur = egp ? (lang === 'ar' ? 'ج.م' : 'EGP') : lang === 'ar' ? 'د.إ' : 'AED';
  const fmt = (n: number) => `${formatAmount(n)} ${cur}`;

  const mode: GoalMode = ledger.goalMode?.[goal.id] ?? 'horizon';
  const outlook = adaptiveOutlook(goal, capacity, minDaily, fxRate);
  const track = horizonTracker(
    goal,
    capacity,
    minDaily,
    horizon,
    fxRate,
    now,
    spend.flexToday,
    spend.allowance,
  );

  const plan = goalPlan(goal, capacity, fxRate, now);
  const at = projectGoal(goal, capacity, fxRate, horizon);
  const req = requirementFor(goal, horizon, capacity, fxRate);
  // Bounded by the living band, so no option can imply a day nobody survives.
  const scenarios = goalScenarios(goal, capacity, fxRate, spend.band);

  const floorCeil = plan.floorMonths != null ? Math.ceil(plan.floorMonths) : null;
  const paceCeil = plan.monthsAtPace != null ? Math.ceil(plan.monthsAtPace) : null;

  function applyMonths(months: number) {
    updateGoal(goal!.id, { months });
  }

  function saveTarget() {
    const v = parseAmount(targetDraft);
    if (v == null || v <= 0) return;
    updateGoal(goal!.id, { target: v });
    setEditing(false);
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{
          padding: SPACE.lg,
          paddingTop: insets.top + SPACE.lg,
          paddingBottom: SPACE.xxl,
        }}
      >
        <Button label={t('back')} variant="secondary" onPress={() => router.back()} />
        <View style={{ height: SPACE.lg }} />
        <Title>{t('goalPlanT')}</Title>

        {goals.length > 1 && (
          <Chips
            value={goal.id}
            onChange={(id) => setSelectedId(id)}
            options={goals.map((g) => ({ id: g.id, label: g[lang] }))}
          />
        )}

        {/* ---- where I stand ---- */}
        <Card>
          <Caption>{goal[lang]}</Caption>
          <Text style={[styles.hero, { color: p.accent, textAlign: rtl ? 'right' : 'left' }]}>
            {fmt(plan.target)}
          </Text>
          <Meter ratio={plan.progress} />
          <View style={{ marginTop: SPACE.sm }}>
            <Row label={t('alreadyHave')} value={fmt(plan.held)} valueColor={p.positive} />
            <Row label={t('remaining')} value={fmt(plan.remaining)} valueColor={p.warn} />
            <Row
              label={t('savingPerMonth')}
              value={`${money(plan.savingPerMonthAed)} · ${fmt(plan.savingPerMonth)}`}
              valueColor={plan.savingPerMonthAed > 0 ? p.positive : p.negative}
            />
          </View>
          <View style={{ marginTop: SPACE.md }}>
            <Button
              label={t('editGoal')}
              variant="secondary"
              onPress={() => {
                setTargetDraft(String(goal.target ?? ''));
                setEditing(true);
              }}
            />
          </View>
        </Card>

        {/* ---- living floor ---- */}
        <Card>
          <Title>{t('livingFloorT')}</Title>
          <Caption>{t('livingFloorNote')}</Caption>
          <View style={{ marginTop: SPACE.sm }}>
            <Row
              label={t('minDaily')}
              value={minDaily > 0 ? money(minDaily) : t('notSet')}
              valueColor={minDaily > 0 ? p.positive : p.warn}
              onPress={() => {
                setFloorDraft(minDaily > 0 ? String(minDaily) : '');
                setFloorSheet(true);
              }}
            />
            {minDaily > 0 && (
              <Row label={t('floorMonthly')} value={money(spend.floorMonthly)} />
            )}
            {spend.goalHeldBack > 0 && (
              <Row
                label={t('heldBackByFloor')}
                value={money(spend.goalHeldBack)}
                valueColor={p.warn}
              />
            )}
            {spend.bufferReq > 0 && (
              <Row label={t('bufMonthly')} value={money(spend.bufferReq)} valueColor={p.accentDeep} />
            )}
          </View>

          {/* Typing a floor from memory is the thing this replaces, so the
              measured alternative sits directly beside the field. */}
          <View style={{ marginTop: SPACE.md }}>
            <Button
              label={t('floorT')}
              variant="secondary"
              onPress={() => router.push('/floor')}
            />
            <Caption style={{ marginTop: SPACE.xs }}>{t('floorSub')}</Caption>
          </View>
          {spend.goalHeldBack > 0 && (
            <Caption style={{ marginTop: SPACE.sm, color: p.warn }}>{t('heldBackNote')}</Caption>
          )}
        </Card>

        {/* ---- mode ---- */}
        <Card>
          <Title>{t('goalModeT')}</Title>
          <Caption>{t('goalModeNote')}</Caption>
          <Chips
            value={mode}
            onChange={(m) => setGoalMode(goal.id, m)}
            options={[
              { id: 'horizon', label: t('modeHorizon') },
              { id: 'stretch', label: t('modeStretch') },
              { id: 'fixed', label: t('modeFixed') },
            ]}
          />
          <Caption>
            {mode === 'horizon'
              ? t('modeHorizonHelp')
              : mode === 'stretch'
                ? t('modeStretchHelp')
                : t('modeFixedHelp')}
          </Caption>
        </Card>

        {/* ---- FIX THE DATE: what will I actually have ---- */}
        {mode === 'horizon' && (
          <Card>
            <Title>{t('landingT')}</Title>
            <Caption>{t('landingNote')}</Caption>

            <Chips
              value={horizon}
              onChange={(h) => setHorizon(h)}
              options={HORIZONS.map((h) => ({ id: h, label: `${h} ${t('monthsW')}` }))}
            />

            <Text style={[styles.hero, { color: track.reachesAspiration ? p.positive : p.accent, textAlign: rtl ? 'right' : 'left' }]}>
              {fmt(track.projected)}
            </Text>
            <Caption>
              {t('byDate')} {MONTHS[lang][track.targetDate.getMonth()]} {track.targetDate.getFullYear()}
            </Caption>

            <View style={{ marginTop: SPACE.md }}>
              <Meter ratio={track.progress} color={track.reachesAspiration ? p.positive : p.accent} />
              <Row
                label={t('percentOfGoal')}
                value={`${num(Math.round(track.progress * 100))}%`}
                valueColor={track.reachesAspiration ? p.positive : p.warn}
              />
              {!track.reachesAspiration && (
                <Row label={t('gapVsAspiration')} value={fmt(track.gap)} valueColor={p.negative} />
              )}
              <Row label={t('ifSpendFloor')} value={fmt(track.projectedAtFloor)} />
              <Row label={t('ifSpendNothing')} value={fmt(track.projectedIfNoSpend)} valueColor={p.positive} />
            </View>

            {/* The lever that makes the number feel controllable. */}
            <View style={{ marginTop: SPACE.md }}>
              <Caption>{t('leverT')}</Caption>
              {[5, 10, 20].map((cut) => (
                <Row
                  key={cut}
                  label={`${t('spendLess')} ${money(cut)} / ${t('dayW')}`}
                  value={`+ ${fmt(track.perDirhamPerDay * cut)}`}
                  valueColor={p.positive}
                />
              ))}
            </View>

            <Caption style={{ marginTop: SPACE.md }}>{t('updatesDaily')}</Caption>
          </Card>
        )}

        {/* ---- the verdict ---- */}
        <Card>
          <Title>{t('whereIStand')}</Title>
          {plan.blocker === 'no-capacity' ? (
            <>
              <Body style={{ color: p.negative }}>{t('blockNoCapacity')}</Body>
              <View style={{ marginTop: SPACE.sm }}>
                <Row label={t('livingPool')} value={money(capacity.poolBeforeGoal)} />
                <Row
                  label={t('projectedMonth')}
                  value={money(capacity.projectedSpend)}
                  valueColor={p.negative}
                />
                <Row
                  label={t('savingPerMonth')}
                  value={money(capacity.saving)}
                  valueColor={p.negative}
                />
              </View>
              <Caption style={{ marginTop: SPACE.sm }}>{t('blockNoCapacityFix')}</Caption>
            </>
          ) : plan.blocker === 'met' ? (
            <Body style={{ color: p.positive }}>{t('goalMet')}</Body>
          ) : (
            <>
              <Body>
                {t('atThisPace')}{' '}
                <Text style={{ color: p.accent, fontWeight: '700' }}>
                  {num(paceCeil ?? 0)} {t('monthsW')}
                </Text>
              </Body>
              {plan.eta && (
                <Body muted>
                  {t('eta')}: {MONTHS[lang][plan.eta.getMonth()]} {plan.eta.getFullYear()}
                </Body>
              )}
              {floorCeil != null && (
                <Caption style={{ marginTop: SPACE.sm }}>
                  {t('floorNote')} {num(floorCeil)} {t('monthsW')}
                </Caption>
              )}
            </>
          )}
        </Card>

        {/* ---- where does my money get me ---- */}
        <Card>
          <Title>{t('whereMoneyGetsMe')}</Title>
          <Caption>{t('whereMoneyGetsMeNote')}</Caption>

          <Chips
            value={horizon}
            onChange={(h) => setHorizon(h)}
            options={HORIZONS.map((h) => ({ id: h, label: `${h} ${t('monthsW')}` }))}
          />

          <View style={{ marginTop: SPACE.sm }}>
            <Meter ratio={at.progress} color={at.reached ? p.positive : p.warn} />
            <Row
              label={`${t('after')} ${num(horizon)} ${t('monthsW')}`}
              value={fmt(at.amount)}
              valueColor={at.reached ? p.positive : p.ink}
            />
            <Row
              label={t('percentOfGoal')}
              value={`${num(Math.round(at.progress * 100))}%`}
              valueColor={at.reached ? p.positive : p.warn}
            />
            {!at.reached && (
              <Row label={t('stillMissing')} value={fmt(at.shortfall)} valueColor={p.negative} />
            )}
          </View>
        </Card>

        {/* ---- what would it take ---- */}
        {mode !== 'horizon' && (
        <Card>
          <Title>
            {t('toFinishIn')} {num(horizon)} {t('monthsW')}
          </Title>

          {!req.feasible ? (
            <View style={[styles.warn, { backgroundColor: p.accentWash, borderColor: p.negative }]}>
              <Body style={{ color: p.negative, fontWeight: '700' }}>{t('impossibleT')}</Body>
              <Caption style={{ marginTop: SPACE.xs }}>
                {t('impossibleS')} {money(req.perMonthAed)} · {t('livingPool')} {money(capacity.poolBeforeGoal)}
              </Caption>
              {floorCeil != null && (
                <Caption style={{ marginTop: SPACE.sm, color: p.warn }}>
                  {t('minimumIs')} {num(floorCeil)} {t('monthsW')}
                </Caption>
              )}
            </View>
          ) : (
            <View style={{ marginTop: SPACE.sm }}>
              <Row label={t('mustSaveMonthly')} value={money(req.perMonthAed)} valueColor={p.accentDeep} />
              <Row label={t('leftToLiveOn')} value={money(req.livingLeftAed)} />
              <Row
                label={t('maxDaily')}
                value={money(req.maxDailyAed)}
                valueColor={p.accent}
              />
              <Row label={t('currentDaily')} value={money(req.currentDailyAed)} />
              {req.comfortable ? (
                <Caption style={{ marginTop: SPACE.sm, color: p.positive }}>{t('noChangeNeeded')}</Caption>
              ) : (
                <Caption style={{ marginTop: SPACE.sm, color: p.warn }}>
                  {t('cutDailyBy')} {money(req.dailyCutAed)}
                </Caption>
              )}
              <View style={{ marginTop: SPACE.md }}>
                <Button label={t('adoptThisPlan')} onPress={() => applyMonths(horizon)} />
              </View>
            </View>
          )}
        </Card>
        )}

        {/* ---- pick a plan ---- */}
        {scenarios.length > 0 && (
          <Card>
            <Title>{t('choosePlan')}</Title>
            <Caption>{t('choosePlanNote')}</Caption>
            <View style={{ marginTop: SPACE.md }}>
              {scenarios.map((s) => {
                const label =
                  s.id === 'fastest' ? t('planFastest') : s.id === 'balanced' ? t('planBalanced') : t('planComfortable');
                const active = goal.months === s.months;
                return (
                  <View
                    key={s.id}
                    style={[
                      styles.plan,
                      { borderColor: active ? p.accent : p.faint, backgroundColor: active ? p.accentWash : 'transparent' },
                    ]}
                  >
                    <Row label={label} value={`${num(s.months)} ${t('monthsW')}`} valueColor={p.accentDeep} />
                    <Caption>
                      {t('mustSaveMonthly')} {money(s.requirement.perMonthAed)} · {t('maxDaily')}{' '}
                      {money(Math.max(0, s.requirement.maxDailyAed))}
                    </Caption>
                    <View style={{ marginTop: SPACE.sm }}>
                      <Button
                        label={active ? t('currentPlan') : t('adoptThisPlan')}
                        variant={active ? 'secondary' : 'primary'}
                        onPress={() => applyMonths(s.months)}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {/* ---- where the app currently has me ---- */}
        <Card>
          <Title>{t('yourCurrentPlan')}</Title>
          {goal.months == null ? (
            <>
              <Body style={{ color: p.warn }}>{t('noPlanYet')}</Body>
              <Caption style={{ marginTop: SPACE.xs }}>{t('noPlanYetNote')}</Caption>
            </>
          ) : (
            <View style={{ marginTop: SPACE.sm }}>
              <Row label={t('deadline')} value={`${num(goal.months)} ${t('monthsW')}`} />
              <Row
                label={t('reservedMonthly')}
                value={money(requirementFor(goal, goal.months, capacity, fxRate).perMonthAed)}
                valueColor={p.accentDeep}
              />
              <Caption style={{ marginTop: SPACE.sm }}>{t('reservedNote')}</Caption>
              <View style={{ marginTop: SPACE.md }}>
                <Button
                  label={t('clearPlan')}
                  variant="secondary"
                  onPress={() => updateGoal(goal.id, { months: null })}
                />
              </View>
            </View>
          )}
        </Card>
      </ScrollView>

      <Sheet
        visible={floorSheet}
        title={t('livingFloorT')}
        onClose={() => setFloorSheet(false)}
        onSubmit={() => {
          setMinDailySpend(parseAmount(floorDraft));
          setFloorSheet(false);
        }}
        submitLabel={t('save')}
      >
        <Caption>{t('floorSheetNote')}</Caption>
        <View style={{ height: SPACE.md }} />
        <TextField label={t('minDaily')} value={floorDraft} onChange={setFloorDraft} numeric big />
        <Caption>
          {t('currentDaily')}: {money(capacity.projectedSpend / capacity.daysInMonth)}
        </Caption>
      </Sheet>

      <Sheet
        visible={editing}
        title={t('editGoal')}
        onClose={() => setEditing(false)}
        onSubmit={saveTarget}
        submitLabel={t('save')}
        canSubmit={(parseAmount(targetDraft) ?? 0) > 0}
      >
        <TextField label={t('goalTarget')} value={targetDraft} onChange={setTargetDraft} numeric big />
        <Caption>{egp ? t('currencyHint') : ''}</Caption>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { fontSize: FONT.large, fontWeight: '800', marginVertical: SPACE.sm },
  warn: { marginTop: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.md, borderWidth: 1 },
  plan: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACE.md, marginBottom: SPACE.md },
});
