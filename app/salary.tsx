import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips, Sheet, TextField } from '../src/components/fields';
import { Body, Button, Caption, Card, Row, Screen, Title } from '../src/components/ui';
import { overtimeTotal, parseAmount } from '../src/domain';
import { useLocalization, usePalette } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { SPACE } from '../src/theme/tokens';

const MULTIPLIERS = ['1', '1.25', '1.5', '2'] as const;

/**
 * Salary and overtime.
 *
 * The base salary is what the Safe Spend Limit divides, so it gets the top of
 * the screen. Overtime is tracked separately and deliberately does NOT raise
 * the daily limit: it is money that may arrive, and sizing daily spending off
 * hours not yet paid is exactly how people overspend.
 */
export default function SalaryScreen() {
  const p = usePalette();
  const { t, money, num, lang } = useLocalization();
  const insets = useSafeAreaInsets();

  const ledger = useLedger((s) => s.ledger);
  const setBase = useLedger((s) => s.setBase);
  const setSalaryStatus = useLedger((s) => s.setSalaryStatus);
  const addOvertime = useLedger((s) => s.addOvertime);
  const removeOvertime = useLedger((s) => s.removeOvertime);
  const addTx = useLedger((s) => s.addTx);

  const [baseSheet, setBaseSheet] = useState(false);
  const [otSheet, setOtSheet] = useState(false);
  const [receiveSheet, setReceiveSheet] = useState(false);

  const [baseDraft, setBaseDraft] = useState('');
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState('');
  const [mult, setMult] = useState<string>('1.25');
  const [actual, setActual] = useState('');

  const ot = overtimeTotal(ledger.otEntries);
  const expected = ledger.base + ot;

  function saveBase() {
    const v = parseAmount(baseDraft);
    if (v == null || v < 0) return;
    setBase(v);
    setBaseSheet(false);
  }

  function saveOvertime() {
    const h = parseAmount(hours);
    const r = parseAmount(rate);
    const m = parseAmount(mult);
    if (h == null || r == null || m == null || h <= 0) return;
    addOvertime({
      h,
      rate: r,
      mult: m,
      date: new Date().toISOString().slice(0, 10),
    });
    setHours('');
    setRate('');
    setOtSheet(false);
  }

  function receiveSalary() {
    const v = parseAmount(actual);
    if (v == null || v <= 0) return;
    // Salary arriving is real money into the bank, so it posts to the ledger
    // rather than only flipping a status flag.
    addTx({
      ts: Date.now(),
      type: 'income',
      acct: 'bank',
      amt: v,
      m: 'الراتب',
      mEn: 'Salary',
    });
    setSalaryStatus('received', v);
    setActual('');
    setReceiveSheet(false);
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
        <Title>{t('salaryWork')}</Title>

        <Card>
          <Row
            label={t('baseSalary')}
            value={money(ledger.base)}
            onPress={() => {
              setBaseDraft(String(ledger.base || ''));
              setBaseSheet(true);
            }}
          />
          <Row label={t('overtime')} value={money(ot)} valueColor={p.positive} />
          <Row label={t('expectedTotal')} value={money(expected)} valueColor={p.ink} />
          <Row
            label={t('status')}
            value={ledger.salStatus === 'received' ? t('received') : t('expectedStatus')}
            valueColor={ledger.salStatus === 'received' ? p.positive : p.warn}
          />
          <Caption style={{ marginTop: SPACE.sm }}>{t('overtimeNote')}</Caption>

          {ledger.salStatus !== 'received' && (
            <View style={{ marginTop: SPACE.md }}>
              <Button
                label={t('markSalaryReceived')}
                onPress={() => {
                  setActual(String(expected || ''));
                  setReceiveSheet(true);
                }}
              />
            </View>
          )}
        </Card>

        <Card>
          <Title>{t('overtime')}</Title>
          {ledger.otEntries.length === 0 ? (
            <Body muted style={{ marginTop: SPACE.md }}>{t('overtimeEmpty')}</Body>
          ) : (
            <View style={{ marginTop: SPACE.sm }}>
              {ledger.otEntries.map((e) => (
                <Row
                  key={e.id}
                  label={`${num(e.h)} ${t('hoursW')} × ${num(e.rate)} × ${e.mult} · ${e.date}`}
                  value={money(e.h * e.rate * e.mult)}
                  onPress={() => removeOvertime(e.id)}
                />
              ))}
              <Caption style={{ marginTop: SPACE.sm }}>{t('tapToDelete')}</Caption>
            </View>
          )}
          <View style={{ marginTop: SPACE.lg }}>
            <Button label={t('addOvertime')} onPress={() => setOtSheet(true)} />
          </View>
        </Card>
      </ScrollView>

      <Sheet
        visible={baseSheet}
        title={t('baseSalary')}
        onClose={() => setBaseSheet(false)}
        onSubmit={saveBase}
        submitLabel={t('save')}
        canSubmit={(parseAmount(baseDraft) ?? -1) >= 0}
      >
        <TextField label={t('baseSalary')} hint={t('salaryHint')} value={baseDraft} onChange={setBaseDraft} numeric big />
      </Sheet>

      <Sheet
        visible={otSheet}
        title={t('addOvertime')}
        onClose={() => setOtSheet(false)}
        onSubmit={saveOvertime}
        submitLabel={t('save')}
        canSubmit={(parseAmount(hours) ?? 0) > 0 && parseAmount(rate) != null}
      >
        <TextField label={t('hoursW')} value={hours} onChange={setHours} numeric big />
        <TextField label={t('hourlyRate')} value={rate} onChange={setRate} numeric />
        <Chips
          label={t('multiplier')}
          value={mult}
          onChange={setMult}
          options={MULTIPLIERS.map((m) => ({ id: m, label: `×${m}` }))}
        />
        {(parseAmount(hours) ?? 0) > 0 && parseAmount(rate) != null && (
          <Body muted>
            {money((parseAmount(hours) ?? 0) * (parseAmount(rate) ?? 0) * (parseAmount(mult) ?? 1))}
          </Body>
        )}
      </Sheet>

      <Sheet
        visible={receiveSheet}
        title={t('markSalaryReceived')}
        onClose={() => setReceiveSheet(false)}
        onSubmit={receiveSalary}
        submitLabel={t('save')}
        canSubmit={(parseAmount(actual) ?? 0) > 0}
      >
        <TextField
          label={t('actualReceived')}
          hint={t('actualHint')}
          value={actual}
          onChange={setActual}
          numeric
          big
        />
      </Sheet>
    </Screen>
  );
}
