import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips, DayPicker, Sheet, TextField } from '../src/components/fields';
import { Body, Button, Caption, Card, Meter, Row, Screen, Title } from '../src/components/ui';
import { parseAmount, type Account } from '../src/domain';
import { useCardPosition, useLocalization, usePalette } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { SPACE } from '../src/theme/tokens';

/**
 * Credit card.
 *
 * The opening position is captured once; everything after that is derived from
 * the ledger. That is the whole point — the prototype's rule was that
 * calculated figures are read-only and only change through recorded
 * transactions or a documented reconciliation, so a surprising balance can
 * always be traced to something.
 */
export default function CardScreen() {
  const p = usePalette();
  const { t, money, num } = useLocalization();
  const insets = useSafeAreaInsets();
  const cc = useCardPosition();

  const ledger = useLedger((s) => s.ledger);
  const setCardSetup = useLedger((s) => s.setCardSetup);
  const setCardConfig = useLedger((s) => s.setCardConfig);
  const reconcileCard = useLedger((s) => s.reconcileCard);
  const payCard = useLedger((s) => s.payCard);

  const [sheet, setSheet] = useState<null | 'setup' | 'config' | 'pay' | 'reconcile'>(null);

  const [stmt0, setStmt0] = useState('');
  const [unbilled0, setUnbilled0] = useState('');
  const [instBal, setInstBal] = useState('');
  const [instMo, setInstMo] = useState('');
  const [limit, setLimit] = useState('');
  const [closeDay, setCloseDay] = useState<number | null>(null);
  const [dueDay, setDueDay] = useState<number | null>(null);
  const [payAmt, setPayAmt] = useState('');
  const [payAcct, setPayAcct] = useState<Account>('bank');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');

  const isSetUp = ledger.cardSetup != null;
  const utilization = ledger.cardCfg.limit > 0 ? cc.utilized / ledger.cardCfg.limit : 0;

  function openSetup() {
    const s = ledger.cardSetup ?? {};
    setStmt0(s.stmt0 != null ? String(s.stmt0) : '');
    setUnbilled0(s.unbilled0 != null ? String(s.unbilled0) : '');
    setInstBal(s.instBal != null ? String(s.instBal) : '');
    setInstMo(s.instMo != null ? String(s.instMo) : '');
    setSheet('setup');
  }

  function saveSetup() {
    // Blank counts as zero, matching the prototype — a card with no
    // installment plan should not force the user to type 0 twice.
    setCardSetup({
      stmt0: parseAmount(stmt0) ?? 0,
      unbilled0: parseAmount(unbilled0) ?? 0,
      instBal: parseAmount(instBal) ?? 0,
      instMo: parseAmount(instMo) ?? 0,
    });
    setSheet(null);
  }

  function saveConfig() {
    const l = parseAmount(limit);
    setCardConfig({
      limit: l ?? ledger.cardCfg.limit,
      closeDay: closeDay ?? ledger.cardCfg.closeDay,
      dueDay: dueDay ?? ledger.cardCfg.dueDay,
    });
    setSheet(null);
  }

  function doPay() {
    const v = parseAmount(payAmt);
    if (v == null || v <= 0) return;
    payCard(v, payAcct);
    setPayAmt('');
    setSheet(null);
  }

  function doReconcile() {
    const want = parseAmount(target);
    if (want == null) return;
    // Stored as a delta against the calculated figure, never as an override of
    // it, so the derivation from transactions stays intact.
    reconcileCard(want - cc.out, reason);
    setTarget('');
    setReason('');
    setSheet(null);
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
        <Title>{t('creditCard')}</Title>

        {!isSetUp && (
          <Card>
            <Title>{t('cardSetupT')}</Title>
            <Caption>{t('cardSetupS')}</Caption>
            <View style={{ marginTop: SPACE.md }}>
              <Button label={t('cardSetupBtn')} onPress={openSetup} />
            </View>
          </Card>
        )}

        <Card>
          <Title>{t('cardCalcT')}</Title>
          <Caption>{t('cardCalcNote')}</Caption>
          <View style={{ marginTop: SPACE.sm }}>
            <Row label={t('stmtRem')} value={money(cc.stmtRem)} valueColor={p.negative} />
            <Row label={t('unbilled')} value={money(cc.unbilled)} />
            <Row label={t('instBal')} value={money(cc.instBal)} />
            <Row label={t('instMo')} value={money(cc.instMo)} />
            <Row label={t('cardOut')} value={money(cc.out)} valueColor={p.negative} />
            <Row
              label={t('availCard')}
              value={money(cc.avail)}
              valueColor={cc.avail > 0 ? p.positive : p.negative}
            />
          </View>

          {ledger.cardCfg.limit > 0 && (
            <View style={{ marginTop: SPACE.md }}>
              <Meter
                ratio={utilization}
                color={utilization > 0.7 ? p.negative : utilization > 0.4 ? p.warn : p.accent}
              />
              <Caption style={{ marginTop: SPACE.sm }}>
                {t('utilization')}: {num(Math.round(utilization * 100))}%
              </Caption>
            </View>
          )}

          {ledger.cardAdj !== 0 && (
            <Caption style={{ marginTop: SPACE.sm, color: p.warn }}>
              {t('cardAdjTag')}: {money(ledger.cardAdj)}
              {ledger.cardAdjNote ? ` — ${ledger.cardAdjNote}` : ''}
            </Caption>
          )}

          <View style={{ marginTop: SPACE.lg, gap: SPACE.sm }}>
            <Button label={t('payCard')} onPress={() => setSheet('pay')} disabled={cc.out <= 0} />
            <Button label={t('cardRec')} variant="secondary" onPress={() => setSheet('reconcile')} />
            {isSetUp && <Button label={t('cardSetupT')} variant="secondary" onPress={openSetup} />}
          </View>
        </Card>

        <Card>
          <Title>{t('cardCfgT')}</Title>
          <Caption>{t('cardCfgNote')}</Caption>
          <View style={{ marginTop: SPACE.sm }}>
            <Row label={t('cardLimit')} value={money(ledger.cardCfg.limit)} />
            <Row label={t('closeDay')} value={num(ledger.cardCfg.closeDay)} />
            <Row label={t('dueDay')} value={num(ledger.cardCfg.dueDay)} />
          </View>
          <View style={{ marginTop: SPACE.md }}>
            <Button
              label={t('edit')}
              variant="secondary"
              onPress={() => {
                setLimit(String(ledger.cardCfg.limit || ''));
                setCloseDay(ledger.cardCfg.closeDay);
                setDueDay(ledger.cardCfg.dueDay);
                setSheet('config');
              }}
            />
          </View>
        </Card>
      </ScrollView>

      <Sheet
        visible={sheet === 'setup'}
        title={t('cardSetupT')}
        onClose={() => setSheet(null)}
        onSubmit={saveSetup}
        submitLabel={t('save')}
      >
        <Caption>{t('cardSetupNote')}</Caption>
        <View style={{ height: SPACE.md }} />
        <TextField label={t('stmt0L')} hint={t('stmt0Hint')} value={stmt0} onChange={setStmt0} numeric />
        <TextField label={t('unbilled0L')} hint={t('unbilled0Hint')} value={unbilled0} onChange={setUnbilled0} numeric />
        <TextField label={t('instBal')} value={instBal} onChange={setInstBal} numeric />
        <TextField label={t('instMo')} value={instMo} onChange={setInstMo} numeric />
      </Sheet>

      <Sheet
        visible={sheet === 'config'}
        title={t('cardCfgT')}
        onClose={() => setSheet(null)}
        onSubmit={saveConfig}
        submitLabel={t('save')}
      >
        <TextField label={t('cardLimit')} value={limit} onChange={setLimit} numeric big />
        <DayPicker label={t('closeDay')} value={closeDay} onChange={setCloseDay} />
        <DayPicker label={t('dueDay')} value={dueDay} onChange={setDueDay} />
      </Sheet>

      <Sheet
        visible={sheet === 'pay'}
        title={t('payCard')}
        onClose={() => setSheet(null)}
        onSubmit={doPay}
        submitLabel={t('save')}
        canSubmit={(parseAmount(payAmt) ?? 0) > 0}
      >
        <Body muted>{t('cardOut')}: {money(cc.out)}</Body>
        <View style={{ height: SPACE.md }} />
        <TextField label={t('enterAmount')} value={payAmt} onChange={setPayAmt} numeric big />
        <Chips
          label={t('account')}
          value={payAcct}
          onChange={setPayAcct}
          options={[
            { id: 'bank', label: t('bankAcct') },
            { id: 'cash', label: t('cashAcct') },
          ]}
        />
      </Sheet>

      <Sheet
        visible={sheet === 'reconcile'}
        title={t('cardRec')}
        onClose={() => setSheet(null)}
        onSubmit={doReconcile}
        submitLabel={t('save')}
        canSubmit={parseAmount(target) != null && reason.trim().length > 0}
      >
        <Caption>{t('cardRecNote')}</Caption>
        <View style={{ height: SPACE.md }} />
        <Body muted>{t('calculated')}: {money(cc.out)}</Body>
        <View style={{ height: SPACE.md }} />
        <TextField label={t('realOutstanding')} value={target} onChange={setTarget} numeric big />
        <TextField label={t('reason')} hint={t('reasonHint')} value={reason} onChange={setReason} multiline />
      </Sheet>
    </Screen>
  );
}
