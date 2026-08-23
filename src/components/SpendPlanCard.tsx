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
}: {
  plan: SpendPlan;
  goal: Goal;
  projectedAtPace: number | null;
}) {
  const { t, money, num, lang, rtl } = useLocalization();
  const p = usePalette();

  const egp = isEgpGoal(goal);
  const fmt = (n: number) => (egp ? formatEgp(n, lang) : money(n));

  // Which way actual spending has moved the landing figure. A tolerance keeps
  // rounding noise from being reported as progress.
  const drift =
    projectedAtPace == null ? 0 : projectedAtPace - plan.projected;
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
            color: plan.reachesTarget ? p.positive : p.warn,
            textAlign: rtl ? 'right' : 'left',
          }}
        >
          {fmt(plan.projected)}{' '}
          <Body style={{ fontSize: FONT.body, color: p.sub }}>
            {t('planOf')} {fmt(plan.target)}
          </Body>
        </Body>
        <View style={{ marginTop: SPACE.sm }}>
          <Meter ratio={plan.progress} color={plan.reachesTarget ? p.positive : p.warn} />
        </View>
        {plan.reachesTarget ? (
          <Caption style={{ color: p.positive, marginTop: SPACE.sm }}>{t('planReaches')}</Caption>
        ) : (
          <Row label={t('planGap')} value={fmt(plan.gap)} valueColor={p.negative} />
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

      <View style={{ marginTop: SPACE.lg }}>
        <Button label={t('editGoal')} variant="secondary" onPress={() => router.push('/goal-plan')} />
      </View>
    </Card>
  );
}
