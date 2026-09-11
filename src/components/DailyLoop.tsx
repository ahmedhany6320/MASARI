import { router } from 'expo-router';
import { View } from 'react-native';
import {
  formatEgp,
  isEgpGoal,
  type DailyAdaptation,
  type Goal,
  type LivingBand,
  type TargetAdaptation,
} from '../domain';
import { useLocalization, usePalette } from '../store/selectors';
import { SPACE } from '../theme/tokens';
import { Body, Caption, Card, Meter, Row, Title } from './ui';

/**
 * What the loop did today, and what it cost or bought.
 *
 * The daily figure on its own is just a number; what makes it trustworthy is
 * seeing the consequence attached to it. Spend more and the days ahead tighten
 * — shown. Spend less and half is locked to the goal — shown. Overrun far
 * enough that the floor has to hold and the goal gives way — shown, because a
 * silent adjustment there is exactly the kind that destroys confidence in
 * every other number on the screen.
 */
export function DailyLoopCard({
  daily,
  band,
  target,
  goal,
}: {
  daily: DailyAdaptation;
  band: LivingBand;
  target: TargetAdaptation | null;
  goal: Goal | null;
}) {
  const { t, money, num, rtl } = useLocalization();
  const p = usePalette();

  const zoneLabel =
    daily.zone === 'comfort'
      ? t('zoneComfort')
      : daily.zone === 'tight'
        ? t('zoneTight')
        : daily.zone === 'floor'
          ? t('zoneFloor')
          : t('zoneUnset');

  const zoneColor =
    daily.zone === 'comfort' ? p.positive : daily.zone === 'tight' ? p.warn : p.negative;

  const fmt = (n: number) => (goal != null && isEgpGoal(goal) ? formatEgp(n, 'ar') : money(n));

  return (
    <>
      <Card>
        <Title>{t('dailyT')}</Title>

        <View style={{ marginTop: SPACE.sm }}>
          <Caption style={{ color: zoneColor }}>{zoneLabel}</Caption>
          {/* Position within the band rather than a bare percentage: the two
              ends are the only reference points that mean anything here. */}
          {band.comfort > band.min && (
            <View style={{ marginTop: SPACE.sm }}>
              <Meter ratio={daily.bandPosition} color={zoneColor} />
              <View
                style={{
                  flexDirection: rtl ? 'row-reverse' : 'row',
                  justifyContent: 'space-between',
                  marginTop: SPACE.xs,
                }}
              >
                <Caption>{money(band.min)}</Caption>
                <Caption>{money(band.comfort)}</Caption>
              </View>
            </View>
          )}
        </View>

        <View style={{ marginTop: SPACE.lg }}>
          <Row
            label={daily.onTrack ? t('dailyAhead') : t('dailyBehind')}
            value={money(Math.abs(daily.variance))}
            valueColor={daily.onTrack ? p.positive : p.negative}
          />
          <Row label={t('dailyPlanned')} value={money(daily.plannedDaily)} />
          <Row label={t('dailyRemaining')} value={money(Math.max(0, daily.remaining))} />
        </View>

        {/* Thrift has to buy something visible, or nobody repeats it. */}
        {daily.bankedToGoal > 0 && (
          <View style={{ marginTop: SPACE.lg }}>
            <Row
              label={t('dailyBanked')}
              value={money(daily.bankedToGoal)}
              valueColor={p.positive}
            />
            <Caption style={{ marginTop: SPACE.xs }}>{t('dailyBankedNote')}</Caption>
          </View>
        )}

        {/* And the reverse: when the floor held, something paid for it. */}
        {daily.goalAbsorbed > 0 && (
          <View style={{ marginTop: SPACE.lg }}>
            <Row
              label={t('dailyAbsorbed')}
              value={money(daily.goalAbsorbed)}
              valueColor={p.warn}
            />
            <Caption style={{ marginTop: SPACE.xs }}>{t('dailyAbsorbedNote')}</Caption>
          </View>
        )}
      </Card>

      {target != null && target.original > 0 && goal != null && (
        <Card>
          <Title>{t('adaptT')}</Title>

          <View style={{ marginTop: SPACE.sm }}>
            <Row label={t('adaptOriginal')} value={fmt(target.original)} />
            <Row
              label={t('adaptAchievable')}
              value={fmt(target.adapted)}
              valueColor={target.reachesOriginal ? p.positive : p.warn}
            />
            {target.shortfall > 0 && (
              <Row label={t('adaptShort')} value={fmt(target.shortfall)} valueColor={p.negative} />
            )}
          </View>

          <View style={{ marginTop: SPACE.sm }}>
            <Meter
              ratio={target.progress}
              color={target.reachesOriginal ? p.positive : p.warn}
            />
          </View>

          {target.reachesOriginal ? (
            <Caption style={{ color: p.positive, marginTop: SPACE.sm }}>{t('adaptRestored')}</Caption>
          ) : (
            <Caption style={{ marginTop: SPACE.sm }}>{t('adaptNote')}</Caption>
          )}

          <View style={{ marginTop: SPACE.md }}>
            <Row label={t('planT')} value={num(goal.months ?? 0) + ' ' + t('monthsW')}
              onPress={() => router.push('/goal-plan')} />
          </View>
        </Card>
      )}
    </>
  );
}
