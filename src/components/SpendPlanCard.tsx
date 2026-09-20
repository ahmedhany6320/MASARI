import { router } from 'expo-router';
import { View } from 'react-native';
import { formatEgp, isEgpGoal, type Goal, type SpendPlan } from '../domain';
import { useLocalization, usePalette } from '../store/selectors';
import { FONT, SPACE } from '../theme/tokens';
import { Body, Button, Caption, Card, Meter, Row, Title } from './ui';

/**
 * The goal-driven spending plan, stated as a commitment rather than a residual.
 *
 * The headline is the daily figure, because on this basis it is the one thing
 * the user actually decides. Everything under it explains what that decision
 * buys: what the goal receives, where it lands, and — when the target is out
 * of reach — that the plan adapted by slipping the GOAL rather than by
 * shrinking the person's life.
 */
export function SpendPlanCard({
  plan,
  goal,
  projectedAtPace,
  landing,
  ladder,
}: {
  plan: SpendPlan;
  goal: Goal;
  projectedAtPace: number | null;
  /**
   * Where the goal lands, from the engine's single canonical figure. The
   * plan's own `projected` deliberately is NOT used: it is built before the
   * daily loop's banking and before obligation variance, so showing it beside
   * the adapted figure put two different answers to one question on one card.
   */
  landing: number;
  ladder: { daily: number; landing: number; reaches: boolean }[];
}) {
  const { t, money, num, lang, rtl } = useLocalization();
  const p = usePalette();

  const egp = isEgpGoal(goal);
  const fmt = (n: number) => (egp ? formatEgp(n, lang) : money(n));

  // Which way actual spending has moved the landing figure. A tolerance keeps
  // rounding noise from being reported as progress.
  const drift = projectedAtPace == null ? 0 : projectedAtPace - landing;
  const driftShown = Math.abs(drift) > Math.max(1, plan.target * 1e-6);

  const sourceNote =
    plan.source === 'target'
      ? t('planSrcTarget')
      : plan.source === 'floor'
        ? t('planSrcFloor')
        : t('planSrcPool');

  return (
    <Card>
      <Title>{t('planT')}</Title>

      <Caption style={{ marginTop: SPACE.sm }}>{t('planSpendDaily')}</Caption>
      <Body
        style={{
          fontSize: FONT.hero,
          fontWeight: '700',
          color: p.accent,
          textAlign: rtl ? 'right' : 'left',
        }}
      >
        {money(plan.dailyAllowance)}
      </Body>
      <Caption style={{ color: plan.source === 'target' ? p.sub : p.warn }}>{sourceNote}</Caption>

      <View style={{ marginTop: SPACE.lg }}>
        <Row label={t('planToGoal')} value={money(plan.monthlyToGoal)} valueColor={p.positive} />
        <Row
          label={`${t('deadline')} · ${num(plan.months)} ${t('monthsW')}`}
          value={fmt(plan.target)}
        />
      </View>

      <View style={{ marginTop: SPACE.lg }}>
        <Caption>{t('planLands')}</Caption>
        <Body
          style={{
            fontSize: FONT.large,
            fontWeight: '700',
            color: landing >= plan.target ? p.positive : p.warn,
            textAlign: rtl ? 'right' : 'left',
          }}
        >
          {fmt(landing)}{' '}
          <Body style={{ fontSize: FONT.body, color: p.sub }}>
            {t('planOf')} {fmt(plan.target)}
          </Body>
        </Body>
        <View style={{ marginTop: SPACE.sm }}>
          <Meter ratio={plan.progress} color={plan.reachesTarget ? p.positive : p.warn} />
        </View>
        {landing >= plan.target ? (
          <Caption style={{ color: p.positive, marginTop: SPACE.sm }}>{t('planReaches')}</Caption>
        ) : (
          <Row label={t('planGap')} value={fmt(Math.max(0, plan.target - landing))} valueColor={p.negative} />
        )}
        <Caption style={{ marginTop: SPACE.xs }}>{t('planLandsNote')}</Caption>
      </View>

      {/* What the month is REALLY doing, as opposed to what it planned to. */}
      {projectedAtPace != null && driftShown && (
        <View style={{ marginTop: SPACE.lg }}>
          <Row
            label={t('planAtPace')}
            value={fmt(projectedAtPace)}
            valueColor={drift > 0 ? p.positive : p.negative}
          />
          <Caption style={{ color: drift > 0 ? p.positive : p.warn }}>
            {drift > 0 ? t('planAtPaceUp') : t('planAtPaceDown')}
          </Caption>
        </View>
      )}

      <View style={{ marginTop: SPACE.lg }}>
        <Row label={t('planPerDirham')} value={`+ ${fmt(plan.perDirhamPerDay)}`} valueColor={p.accentDeep} />
        <Caption style={{ marginTop: SPACE.xs }}>{t('planPerDirhamNote')}</Caption>
      </View>

      {/*
        The trade-off, made explorable. Reading a single prescribed figure
        tells you what to do; seeing what the neighbouring figures cost tells
        you why, which is the difference between following a plan and owning
        one.
      */}
      {ladder.length > 1 && (
        <View style={{ marginTop: SPACE.lg }}>
          <Caption>{t('ladderT')}</Caption>
          <View style={{ marginTop: SPACE.sm }}>
            {ladder.map((step) => {
              const current = Math.abs(step.daily - plan.dailyAllowance) < 0.5;
              return (
                <Row
                  key={step.daily}
                  label={`${money(step.daily)} ${t('ladderDaily')}${current ? ' •' : ''}`}
                  value={fmt(step.landing)}
                  valueColor={step.reaches ? p.positive : current ? p.ink : p.sub}
                />
              );
            })}
          </View>
          <Caption style={{ marginTop: SPACE.xs }}>{t('ladderNote')}</Caption>
        </View>
      )}

      <View style={{ marginTop: SPACE.lg }}>
        <Button label={t('editGoal')} variant="secondary" onPress={() => router.push('/goal-plan')} />
      </View>
    </Card>
  );
}
