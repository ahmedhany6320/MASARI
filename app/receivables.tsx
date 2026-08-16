import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips, Sheet, TextField } from '../src/components/fields';
import { Body, Button, Caption, Card, Row, Screen, Title } from '../src/components/ui';
import { parseAmount, type Account } from '../src/domain';
import { useLocalization, usePalette, useSafeSpend } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { SPACE } from '../src/theme/tokens';

/**
 * Expected money.
 *
 * The governing rule, carried over from the prototype: expected money is NEVER
 * added to the available balance. It is shown alongside so the user can see
 * what is coming, and only enters the ledger when it actually arrives — at the
 * amount that actually arrived, which is often not the estimate.
 */
export default function ReceivablesScreen() {
  const p = usePalette();
  const { t, lang, money, rtl } = useLocalization();
  const insets = useSafeAreaInsets();
  const c = useSafeSpend();

  const ledger = useLedger((s) => s.ledger);
  const addReceivable = useLedger((s) => s.addReceivable);
  const removeReceivable = useLedger((s) => s.removeReceivable);
  const receiveReceivable = useLedger((s) => s.receiveReceivable);

  const [sheet, setSheet] = useState<null | { kind: 'add' } | { kind: 'receive'; id: string }>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [exact, setExact] = useState<'yes' | 'no'>('yes');
  const [acct, setAcct] = useState<Account>('bank');

  const pending = ledger.recv.filter((r) => r.status !== 'received');
  const lent = ledger.people.filter((x) => x.dir === 'owed' && x.out > 0);

  const pendingSum = pending.reduce((a, r) => a + r.amt, 0);
  const lentSum = lent.reduce((a, x) => a + x.out, 0);
  const total = pendingSum + lentSum;

  const amountVal = parseAmount(amount);

  function save() {
    if (!sheet) return;
    if (sheet.kind === 'add') {
      if (!name.trim() || amountVal == null || amountVal <= 0) return;
      addReceivable({
        ar: name.trim(),
        en: name.trim(),
        amt: amountVal,
        exact: exact === 'yes',
        status: 'expected',
        actual: null,
      });
      setName('');
      setAmount('');
    } else {
      if (amountVal == null || amountVal <= 0) return;
      receiveReceivable(sheet.id, amountVal, acct);
      setAmount('');
    }
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
        <Title>{t('expMoneyLong')}</Title>

        <Card>
          <Row label={t('availNow')} value={money(c.liquid)} />
          <Row label={t('expMoney')} value={`≈ ${money(total)}`} valueColor={p.warn} />
          <Row label={t('projAfter')} value={money(c.liquid + total)} valueColor={p.positive} />
          <Caption style={{ marginTop: SPACE.sm }}>{t('notCounted')}</Caption>
        </Card>

        <Card>
          <Title>{t('expMoney')}</Title>
          {pending.length === 0 ? (
            <Body muted style={{ marginTop: SPACE.md }}>{t('noReceivables')}</Body>
          ) : (
            <View style={{ marginTop: SPACE.sm }}>
              {pending.map((r) => (
                <View key={r.id} style={{ marginBottom: SPACE.md }}>
                  <Row
                    label={r[lang]}
                    value={`${r.exact ? '' : '≈ '}${money(r.amt)}`}
                    valueColor={p.warn}
                  />
                  <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', gap: SPACE.sm, flexWrap: 'wrap', paddingVertical: SPACE.sm }}>
                    <Button
                      label={t('markReceived')}
                      variant="secondary"
                      onPress={() => {
                        setAmount(String(r.amt));
                        setAcct('bank');
                        setSheet({ kind: 'receive', id: r.id });
                      }}
                    />
                    <Button
                      label={t('del')}
                      variant="secondary"
                      onPress={() =>
                        Alert.alert(r[lang], t('deleteConfirm'), [
                          { text: t('cancel'), style: 'cancel' },
                          { text: t('del'), style: 'destructive', onPress: () => removeReceivable(r.id) },
                        ])
                      }
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
          <View style={{ marginTop: SPACE.lg }}>
            <Button label={t('add')} onPress={() => setSheet({ kind: 'add' })} />
          </View>
        </Card>

        {lent.length > 0 && (
          <Card>
            <Title>{t('lentPending')}</Title>
            <Caption>{t('lentNote')}</Caption>
            <View style={{ marginTop: SPACE.sm }}>
              {lent.map((person) => (
                <Row key={person.id} label={person.name} value={money(person.out)} valueColor={p.positive} />
              ))}
            </View>
          </Card>
        )}
      </ScrollView>

      <Sheet
        visible={sheet != null}
        title={sheet?.kind === 'receive' ? t('markReceived') : t('add')}
        onClose={() => setSheet(null)}
        onSubmit={save}
        submitLabel={t('save')}
        canSubmit={
          sheet?.kind === 'add' ? name.trim().length > 0 && (amountVal ?? 0) > 0 : (amountVal ?? 0) > 0
        }
      >
        {sheet?.kind === 'add' ? (
          <>
            <TextField label={t('recvNamePh')} value={name} onChange={setName} />
            <TextField label={t('enterAmount')} value={amount} onChange={setAmount} numeric big />
            <Chips
              label={t('amountCertainty')}
              value={exact}
              onChange={setExact}
              options={[
                { id: 'yes', label: t('exactAmount') },
                { id: 'no', label: t('estimateTag') },
              ]}
            />
          </>
        ) : (
          <>
            <Caption>{t('actualHint')}</Caption>
            <View style={{ height: SPACE.md }} />
            <TextField label={t('actualReceived')} value={amount} onChange={setAmount} numeric big />
            <Chips
              label={t('account')}
              value={acct}
              onChange={setAcct}
              options={[
                { id: 'bank', label: t('bankAcct') },
                { id: 'cash', label: t('cashAcct') },
              ]}
            />
          </>
        )}
      </Sheet>
    </Screen>
  );
}
