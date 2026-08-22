import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TextField } from '../src/components/fields';
import { Body, Button, Caption, Card, Row, Screen, Title } from '../src/components/ui';
import { parseAmount } from '../src/domain';
import { useLocalization, usePalette } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { SPACE } from '../src/theme/tokens';

/**
 * Start from today.
 *
 * Solves the most common reason people abandon a finance app: it demands weeks
 * of back-filled history before it says anything useful. Instead the user
 * states where they actually are right now, and the app computes forward from
 * this moment.
 *
 * Existing history is KEPT for analytics but stops moving balances — the
 * figures entered here already contain everything that came before, so
 * applying those entries again would double-count. `cycleSpentBefore` records
 * what has already gone this month so the remaining days get the right share
 * rather than a full month's allowance on day 16.
 */
export default function StartTodayScreen() {
  const p = usePalette();
  const { t, money } = useLocalization();
  const insets = useSafeAreaInsets();

  const ledger = useLedger((s) => s.ledger);
  const startFromToday = useLedger((s) => s.startFromToday);

  const [bank, setBank] = useState(String(ledger.bankOpen || ''));
  const [cash, setCash] = useState(ledger.cashOpen != null ? String(ledger.cashOpen) : '');
  const [stmt, setStmt] = useState(String(ledger.cardSetup?.stmt0 ?? ''));
  const [unbilled, setUnbilled] = useState(String(ledger.cardSetup?.unbilled0 ?? ''));
  const [instBal, setInstBal] = useState(String(ledger.cardSetup?.instBal ?? ''));
  const [instMo, setInstMo] = useState(String(ledger.cardSetup?.instMo ?? ''));
  const [spent, setSpent] = useState('');

  const bankVal = parseAmount(bank);
  const canSave = bankVal != null;

  function apply() {
    if (bankVal == null) return;
    Alert.alert(t('startTodayT'), t('startTodayConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('startTodayBtn'),
        onPress: () => {
          startFromToday({
            bank: bankVal,
            cash: cash.trim() === '' ? null : (parseAmount(cash) ?? 0),
            cardStatement: parseAmount(stmt) ?? 0,
            cardUnbilled: parseAmount(unbilled) ?? 0,
            instBal: parseAmount(instBal) ?? 0,
            instMo: parseAmount(instMo) ?? 0,
            spentThisCycle: parseAmount(spent) ?? 0,
          });
          router.replace('/(tabs)');
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: SPACE.lg,
          paddingTop: insets.top + SPACE.lg,
          paddingBottom: SPACE.xxl,
        }}
      >
        <Button label={t('back')} variant="secondary" onPress={() => router.back()} />
        <View style={{ height: SPACE.lg }} />
        <Title>{t('startTodayT')}</Title>
        <Caption>{t('startTodayNote')}</Caption>

        <Card>
          <Title>{t('availNow')}</Title>
          <TextField
            label={t('bankAcct')}
            hint={t('startBankHint')}
            value={bank}
            onChange={setBank}
            numeric
            big
          />
          <TextField
            label={t('cashAcct')}
            hint={t('startCashHint')}
            value={cash}
            onChange={setCash}
            numeric
          />
        </Card>

        <Card>
          <Title>{t('creditCard')}</Title>
          <Caption>{t('startCardHint')}</Caption>
          <View style={{ height: SPACE.md }} />
          <TextField label={t('stmt0L')} hint={t('stmt0Hint')} value={stmt} onChange={setStmt} numeric />
          <TextField
            label={t('unbilled0L')}
            hint={t('unbilled0Hint')}
            value={unbilled}
            onChange={setUnbilled}
            numeric
          />
          <TextField label={t('instBal')} value={instBal} onChange={setInstBal} numeric />
          <TextField label={t('instMo')} value={instMo} onChange={setInstMo} numeric />
        </Card>

        <Card>
          <Title>{t('spentSoFar')}</Title>
          <Caption>{t('spentSoFarHint')}</Caption>
          <View style={{ height: SPACE.md }} />
          <TextField label={t('spentThisCycle')} value={spent} onChange={setSpent} numeric big />
        </Card>

        <Card>
          <Title>{t('whatHappens')}</Title>
          <Row label={t('bankAcct')} value={money(bankVal ?? 0)} />
          <Row label={t('cardOut')} value={money((parseAmount(stmt) ?? 0) + (parseAmount(unbilled) ?? 0))} valueColor={p.negative} />
          <Row label={t('spentThisCycle')} value={money(parseAmount(spent) ?? 0)} />
          <Caption style={{ marginTop: SPACE.sm }}>{t('historyKept')}</Caption>
        </Card>

        <Button label={t('startTodayBtn')} onPress={apply} disabled={!canSave} />
        <View style={{ height: SPACE.sm }} />
        <Body muted>{t('startTodayWarn')}</Body>
      </ScrollView>
    </Screen>
  );
}
