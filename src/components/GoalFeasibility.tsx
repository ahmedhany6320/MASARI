import { View } from 'react-native';
import { formatEgp, isEgpGoal, type Projection } from '../domain';
import { useLocalization, usePalette } from '../store/selectors';
import { FONT, SPACE } from '../theme/tokens';
import { Body, Caption, Card, Meter, Row, Title } from './ui';

/**
 * Whether the goal is reachable, and why — answered from the projection.
 *
 * The three cases are genuinely different and were previously collapsed into
 * one unhelpful outcome: a daily figure driven toward zero. An out-of-reach
 * goal is not a spending problem and no amount of austerity fixes it, so
 * saying "spend nine dirhams a day" is both useless and untrue. What the user
 * needs is the ceiling, the realistic landing point, and the gap between them.
 */
export function GoalFeasibilityCard({ projection }: { projection: Projection }) {
  const { t, money, num, rtl } = useLocalization();
  const p = usePalette();
  const a = projection.assessment;
  const goal = projection.goal;

  if (goal == null || a.feasibility === 'unset') return null;

  const egp = isEgpGoal(goal);
  const fmt = (n: number) => (egp ? formatEgp(n, 'ar') : money(n));

  const headline =
    a.feasibility === 'impossible'
      ? t('pjImpossible')
      : a.feasibility === 'unsustainable'
        ? t('pjUnsustainable')
        : a.feasibility === 'met'
          ? t('pjMet')
          : t('pjFeasible');

  const why =
    a.feasibility === 'impossible'
      ? t('pjImpossibleWhy')
      : a.feasibility === 'unsustainable'
        ? t('pjUnsustainableWhy')
        : a.feasibility === 'met'
          ? ''
          : t('pjFeasibleWhy');

  const tone =
    a.feasibility === 'impossible'
      ? p.negative
      : a.feasibility === 'unsustainable'
        ? p.warn
        : p.positive;

  return (
    <Card>
      <Title>{t('pjT')}</Title>
      <Body
        style={{
          fontSize: FONT.large,
          fontWeight: '700',
          color: tone,
          textAlign: rtl ? 'right' : 'left',
          marginTop: SPACE.sm,
        }}
      >
        {headline}
      </Body>
      {why !== '' && <Caption>{why}</Caption>}

      {/*
        The three scenarios side by side. An impossible goal is impossible
        because the CEILING is below it — showing that is what turns a refusal
        into an explanation.
      */}
      <View style={{ marginTop: SPACE.lg }}>
        <Row label={t('goalTarget')} value={fmt(a.target)} />
        <Row label={t('pjCeiling')} value={fmt(a.maxReachable)} valueColor={p.sub} />
        <Row label={t('pjAustere')} value={fmt(a.austereReachable)} valueColor={p.warn} />
        <Row label={t('pjRealistic')} value={fmt(a.realisticReachable)} valueColor={tone} />
        {a.shortfall > 0 && (
          <Row label={t('pjShortfall')} value={fmt(a.shortfall)} valueColor={p.negative} />
        )}
        {a.requiredDaily != null && (
          <Row label={t('pjNeedDaily')} value={money(a.requiredDaily)} valueColor={p.accentDeep} />
        )}
      </View>

      <View style={{ marginTop: SPACE.sm }}>
        <Meter
          ratio={a.target > 0 ? Math.min(1, a.realisticReachable / a.target) : 0}
          color={tone}
        />
      </View>

      <View style={{ marginTop: SPACE.lg }}>
        <Row label={t('pjNetNow')} value={money(projection.netNow)} valueColor={p.ink} />
        <Caption style={{ marginTop: SPACE.xs }}>{t('pjNetNote')}</Caption>
      </View>

      <Caption style={{ marginTop: SPACE.md }}>{t('pjSource')}</Caption>
    </Card>
  );
}
