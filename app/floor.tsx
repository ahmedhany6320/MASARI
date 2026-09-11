import { Stack, router } from 'expo-router';
import { useMemo } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Caption, Card, Meter, Row, Screen, Title } from '../src/components/ui';
import { recommendBuffer, recommendFloor } from '../src/domain';
import { useLocalization, usePalette, useSafeSpend } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { FONT, SPACE } from '../src/theme/tokens';

/**
 * The living floor and the cash reserve, both derived from real spending.
 *
 * These were a single number typed from memory, which fails twice. Nobody
 * knows their own floor — asked, they answer with an aspiration. And a daily
 * floor is an average, while spending is not: it arrives as a long tail of
 * ordinary days and a short tail of expensive ones. Meeting the average on a
 * day that costs four times it is no comfort at all.
 *
 * So the screen shows the SHAPE of their spending rather than one figure, and
 * proposes two numbers against it: a floor most days fit inside, and a reserve
 * sized from how far the rest actually overshot.
 */
export default function FloorScreen() {
  const p = usePalette();
  const { t, money, num, rtl } = useLocalization();
  const insets = useSafeAreaInsets();
  const c = useSafeSpend();

  const ledger = useLedger((s) => s.ledger);
  const setMinDailySpend = useLedger((s) => s.setMinDailySpend);
  const setBufferTarget = useLedger((s) => s.setBufferTarget);

  const now = useMemo(() => new Date(), []);
  const advice = useMemo(() => recommendFloor(ledger, now), [ledger, now]);
  const daysInMonth = useMemo(
    () => new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    [now],
  );
  const buffer = useMemo(
    () => recommendBuffer(advice, c.bufferHeld, daysInMonth),
    [advice, c.bufferHeld, daysInMonth],
  );

  const pct = (r: number) => num(Math.round(r * 100));
  const fill = (key: 'floorMeasured' | 'floorCoverage' | 'floorDaysOver' | 'bufCovers', n: string) =>
    t(key).replace('{n}', n);
  const density = t('floorDensity')
    .replace('{n}', num(advice.profile.days - advice.profile.quietDays))
    .replace('{d}', num(advice.profile.days));

  const measured = advice.basis !== 'none';

  function applyFloor() {
    Alert.alert(t('floorSuggest'), `${money(advice.floor)} / ${t('perDay')}`, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('floorApply'), onPress: () => setMinDailySpend(advice.floor) },
    ]);
  }

  function applyBuffer() {
    Alert.alert(t('bufSuggest'), money(buffer.target), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('bufApply'), onPress: () => setBufferTarget(buffer.target) },
    ]);
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
        <Title>{t('floorT')}</Title>
        <Caption>{t('floorSub')}</Caption>

        {!measured ? (
          <Card>
            <Body muted>{t('floorNone')}</Body>
          </Card>
        ) : (
          <>
            {/* The distribution, not the average. Seeing an ordinary day and a
                heavy day side by side is what makes the floor make sense. */}
            <Card>
              <Caption>{fill('floorMeasured', num(advice.profile.days))}</Caption>
              {/* How much of the window actually carries data. A quiet day and
                  an unrecorded one look identical in a ledger, so this is what
                  decides whether any of the figures below mean anything. */}
              <Caption style={{ color: advice.profile.density < 0.4 ? p.warn : p.sub }}>
                {density}
              </Caption>
              <View style={{ marginTop: SPACE.sm }}>
                <Row label={t('floorTypical')} value={money(advice.profile.typical)} />
                <Row label={t('floorSteady')} value={money(advice.profile.steady)} />
                <Row
                  label={t('floorComfort')}
                  value={money(advice.profile.comfortable)}
                  valueColor={p.accentDeep}
                />
                <Row label={t('floorBad')} value={money(advice.profile.bad)} valueColor={p.warn} />
                <Row
                  label={t('floorWorst')}
                  value={money(advice.profile.worst)}
                  valueColor={p.negative}
                />
              </View>
              {advice.basis === 'thin-history' && (
                <View style={{ marginTop: SPACE.md }}>
                  <Caption style={{ color: p.warn }}>{t('floorThin')}</Caption>
                  <Caption style={{ marginTop: SPACE.xs }}>{t('floorThinWhy')}</Caption>
                </View>
              )}
            </Card>

            <Card>
              <Caption>{t('floorSuggest')}</Caption>
              <Body
                style={{
                  fontSize: FONT.hero,
                  fontWeight: '700',
                  color: p.accent,
                  textAlign: rtl ? 'right' : 'left',
                }}
              >
                {money(advice.floor)}
              </Body>
              <Caption>{fill('floorCoverage', pct(advice.coverage))}</Caption>
              <View style={{ marginTop: SPACE.sm }}>
                <Meter ratio={advice.coverage} color={p.accent} />
              </View>

              <View style={{ marginTop: SPACE.lg }}>
                <Row
                  label={t('floorCurrent')}
                  value={ledger.minDailySpend != null ? money(ledger.minDailySpend) : '—'}
                />
                <Row label={fill('floorDaysOver', num(advice.daysOver))} value={money(advice.overflow)} />
              </View>

              <Caption style={{ marginTop: SPACE.md }}>{t('floorWhy')}</Caption>
              <View style={{ marginTop: SPACE.lg }}>
                <Button label={t('floorApply')} onPress={applyFloor} />
              </View>
            </Card>

            {/* The overflow measured above becomes the reserve's size, which is
                what ties the two halves of this screen together. */}
            <Card>
              <Title>{t('bufT')}</Title>
              <Caption>{t('bufSub')}</Caption>
              <Caption style={{ marginTop: SPACE.sm }}>{t('bufWhy')}</Caption>

              <View style={{ marginTop: SPACE.lg }}>
                <Caption>{t('bufSuggest')}</Caption>
                <Body
                  style={{
                    fontSize: FONT.large,
                    fontWeight: '700',
                    color: p.accentDeep,
                    textAlign: rtl ? 'right' : 'left',
                  }}
                >
                  {money(buffer.target)}
                </Body>
                <Caption>{fill('bufCovers', num(Math.round(buffer.monthsCovered * 10) / 10))}</Caption>
              </View>

              <View style={{ marginTop: SPACE.md }}>
                <Row
                  label={t('bufTarget')}
                  value={c.bufferTarget > 0 ? money(c.bufferTarget) : t('bufNone')}
                />
                <Row label={t('bufHeld')} value={money(c.bufferHeld)} valueColor={p.positive} />
                {c.bufferShort > 0 && (
                  <Row label={t('bufShort')} value={money(c.bufferShort)} valueColor={p.warn} />
                )}
                {c.bufferReq > 0 && (
                  <Row label={t('bufMonthly')} value={money(c.bufferReq)} valueColor={p.accentDeep} />
                )}
              </View>

              {c.bufferTarget > 0 && (
                <View style={{ marginTop: SPACE.sm }}>
                  <Meter
                    ratio={c.bufferTarget > 0 ? c.bufferHeld / c.bufferTarget : 0}
                    color={c.bufferFunded ? p.positive : p.accentDeep}
                  />
                </View>
              )}

              {c.bufferFunded && c.bufferTarget > 0 && (
                <Caption style={{ color: p.positive, marginTop: SPACE.sm }}>{t('bufFunded')}</Caption>
              )}

              <Caption style={{ marginTop: SPACE.md }}>{t('bufOrder')}</Caption>
              <View style={{ marginTop: SPACE.lg }}>
                <Button label={t('bufApply')} variant="secondary" onPress={applyBuffer} />
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
