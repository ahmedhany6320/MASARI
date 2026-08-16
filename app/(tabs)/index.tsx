import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuickAdd } from '../../src/components/QuickAdd';
import { Body, Button, Caption, Card, Meter, Row, Screen, Title } from '../../src/components/ui';
import { formatShortDate } from '../../src/i18n';
import { useLocalization, usePalette, useSafeSpend } from '../../src/store/selectors';
import { useLedger } from '../../src/store/useLedger';
import { FONT, SPACE } from '../../src/theme/tokens';

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
  const [showHow, setShowHow] = useState(false);
  const [adding, setAdding] = useState(false);

  const ledger = useLedger((s) => s.ledger);

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
            <Caption>{t('sslDesc')}</Caption>
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
              <Row label={t('salaryWork')} value={money(ledger.base)} />
              <Row label={t('upcoming')} value={`− ${money(c.commitObl)}`} />
              <Row label={t('plannedTransfers')} value={`− ${money(c.planT)}`} />
              <Row label={t('goals')} value={`− ${money(c.goalReq)}`} />
              <Row label={t('livingPool')} value={money(c.livingPool)} valueColor={p.ink} />
              <Row label={t('monthSpend')} value={`− ${money(c.cycleSpend)}`} />
              <Row
                label={t('remainingCycle')}
                value={money(Math.max(0, c.spendable))}
                valueColor={c.spendable > 0 ? p.positive : p.negative}
              />
              <Row label={t('daysLeftLabel')} value={`÷ ${num(c.daysLeft)}`} />
              <Caption style={{ marginTop: SPACE.md }}>{t('sslNote')}</Caption>
            </View>
          )}
        </Card>

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
        </Card>

        <Card>
          <Title>{t('nextIncome')}</Title>
          <Body muted>
            {formatShortDate(c.nextPay, lang)} · {num(c.daysLeft)} {t('dayW')}
          </Body>
        </Card>

        <Button label={t('addExpense')} onPress={() => setAdding(true)} />
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
