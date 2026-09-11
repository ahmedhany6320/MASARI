import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Caption, Card, Row, Screen, Title } from '../src/components/ui';
import { forecast, forecastFromLedger } from '../src/domain';
import { MONTHS } from '../src/i18n';
import { useLocalization, usePalette, useSafeSpend } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { FONT, RADIUS, SPACE } from '../src/theme/tokens';

const HORIZONS = [3, 6, 12, 24];

/**
 * Where the balance goes, month after month.
 *
 * Every other screen answers "what about today". This answers the question
 * people actually lie awake on — what will I have when the next salary lands,
 * and the one after that. It is deliberately arithmetic rather than prophecy:
 * four movements repeated, each month opening where the last closed, so every
 * figure can be checked by hand. A forecast nobody can verify is a horoscope.
 */
export default function ForecastScreen() {
  const p = usePalette();
  const { t, money, num, lang, rtl } = useLocalization();
  const insets = useSafeAreaInsets();
  const c = useSafeSpend();
  const ledger = useLedger((s) => s.ledger);

  const [months, setMonths] = useState(12);
  const now = useMemo(() => new Date(), []);

  const rows = useMemo(() => {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    // Planned figures, not this cycle's remainder: later months get the full
    // obligation whether or not this one has already met it.
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
      months,
      now,
    );
  }, [ledger, c, months, now]);

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
        <Title>{t('fcT')}</Title>
        <Caption>{t('fcSub')}</Caption>

        <View
          style={{
            flexDirection: rtl ? 'row-reverse' : 'row',
            gap: SPACE.sm,
            marginVertical: SPACE.lg,
            flexWrap: 'wrap',
          }}
        >
          {HORIZONS.map((h) => {
            const on = h === months;
            return (
              <Pressable
                key={h}
                onPress={() => setMonths(h)}
                style={{
                  paddingVertical: SPACE.sm,
                  paddingHorizontal: SPACE.md,
                  borderRadius: RADIUS.pill,
                  borderWidth: 1,
                  borderColor: on ? p.accent : p.faint,
                  backgroundColor: on ? p.faint : 'transparent',
                }}
              >
                <Text style={{ color: on ? p.accentDeep : p.ink, fontSize: FONT.small }}>
                  {num(h)} {t('hzMonths')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {rows.map((m, i) => {
          const label = `${MONTHS[lang][m.month]} ${num(m.year)}`;
          const negative = m.closing < 0;
          return (
            <Card key={`${m.year}-${m.month}`}>
              <Title>{i === 0 ? `${label} — ${t('fcThisMonth')}` : label}</Title>

              <View style={{ marginTop: SPACE.sm }}>
                <Row label={t('fcOpening')} value={money(m.opening)} />
                {m.salary > 0 && (
                  <Row label={t('fcSalary')} value={`+ ${money(m.salary)}`} valueColor={p.positive} />
                )}
                {m.commitments > 0 && (
                  <Row label={t('fcCommit')} value={`− ${money(m.commitments)}`} />
                )}
                {m.transfers > 0 && (
                  <Row label={t('fcTransfer')} value={`− ${money(m.transfers)}`} />
                )}
                {m.card > 0 && (
                  <Row label={t('fcCard')} value={`− ${money(m.card)}`} valueColor={p.negative} />
                )}
                {m.goal > 0 && (
                  <Row label={t('fcGoal')} value={`− ${money(m.goal)}`} valueColor={p.accentDeep} />
                )}
                {m.living > 0 && <Row label={t('fcLiving')} value={`− ${money(m.living)}`} />}
                <Row
                  label={t('fcClosing')}
                  value={money(m.closing)}
                  valueColor={negative ? p.negative : p.ink}
                />
                <Row label={t('fcSaved')} value={money(m.savedToDate)} valueColor={p.positive} />
              </View>

              {/* Running out is the single most useful thing a forecast can
                  say, so it is stated rather than left to be read off a sign. */}
              {negative && (
                <Caption style={{ color: p.negative, marginTop: SPACE.sm }}>
                  {t('fcNegative')}
                </Caption>
              )}
            </Card>
          );
        })}

        <Body muted style={{ marginTop: SPACE.md }}>{t('fcNote')}</Body>
      </ScrollView>
    </Screen>
  );
}
