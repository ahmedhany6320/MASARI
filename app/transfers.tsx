import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chips, DayPicker, Sheet, TextField } from '../src/components/fields';
import { Body, Button, Caption, Card, Row, Screen, Title } from '../src/components/ui';
import {
  annualFeeCost,
  formatEgp,
  isEgpGoal,
  parseAmount,
  transferStats,
  transferSummary,
} from '../src/domain';
import { formatShortDate } from '../src/i18n';
import { useLocalization, usePalette, useSafeSpend } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { SPACE } from '../src/theme/tokens';

/**
 * International transfers — the EGP side of the app.
 *
 * Two distinct things live here and are deliberately kept apart:
 *
 *  - PLANNED transfers are reserved against the salary, so they shrink the
 *    daily limit before the money has moved. That is what stops someone
 *    spending the rent they are about to send home.
 *  - SENT transfers are history: money that has already left the bank.
 *
 * Conflating them would double-count the same dirhams.
 */
export default function TransfersScreen() {
  const p = usePalette();
  const { t, lang, money, num } = useLocalization();
  const insets = useSafeAreaInsets();
  const c = useSafeSpend();

  const ledger = useLedger((s) => s.ledger);
  const fxRate = useLedger((s) => s.settings.fxRate);
  const setFxRate = useLedger((s) => s.setFxRate);
  const addPlannedTransfer = useLedger((s) => s.addPlannedTransfer);
  const removePlannedTransfer = useLedger((s) => s.removePlannedTransfer);
  const sendTransfer = useLedger((s) => s.sendTransfer);

  const [sheet, setSheet] = useState<null | 'plan' | 'send' | 'rate'>(null);
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState<number | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [rateDraft, setRateDraft] = useState('');
  const [fee, setFee] = useState('');
  const [to, setTo] = useState('');
  const [sentRate, setSentRate] = useState('');

  // 90 days is long enough for fee and rate patterns to mean something, and
  // short enough to still describe current behaviour.
  const WINDOW_DAYS = 90;
  const since = useMemo(() => Date.now() - WINDOW_DAYS * 864e5, []);
  const stats = useMemo(() => transferStats(ledger, since, fxRate), [ledger, since, fxRate]);
  const summary = useMemo(() => transferSummary(ledger, since, fxRate), [ledger, since, fxRate]);
  const yearlyFees = annualFeeCost(summary, WINDOW_DAYS);

  // Recipients already used, so a repeat transfer is one tap rather than typing.
  const knownRecipients = useMemo(
    () => Array.from(new Set(stats.map((x) => x.to).filter((x) => x !== '—'))),
    [stats],
  );

  const sent = useMemo(
    () => ledger.tx.filter((x) => x.type === 'remit').slice(0, 30),
    [ledger.tx],
  );

  const amountVal = parseAmount(amount);
  // Live conversion while typing is the whole reason someone opens this screen.
  const egpPreview = amountVal != null ? amountVal * fxRate : null;

  const goalOptions = [
    { id: '__none__', label: t('noGoal') },
    ...ledger.goals.map((g) => ({ id: g.id, label: g[lang] })),
  ];

  function savePlan() {
    if (amountVal == null || amountVal <= 0) return;
    addPlannedTransfer({ amt: amountVal, day });
    setAmount('');
    setDay(null);
    setSheet(null);
  }

  function doSend() {
    if (amountVal == null || amountVal <= 0) return;
    const goal = goalId && goalId !== '__none__' ? ledger.goals.find((g) => g.id === goalId) : null;
    // The rate actually used, which may differ from today's stored rate.
    const usedRate = parseAmount(sentRate) ?? fxRate;
    sendTransfer({
      amt: amountVal,
      fee: parseAmount(fee) ?? 0,
      rate: usedRate,
      to: to.trim() || undefined,
      purpose: goal ? 'goal' : 'other',
      memo: note.trim() || undefined,
      goalId: goal?.id,
      // An EGP-denominated goal is credited in pounds, at the rate this
      // transfer actually achieved — not at today's.
      egp: goal && isEgpGoal(goal) ? amountVal * usedRate : undefined,
    });
    setAmount('');
    setNote('');
    setFee('');
    setTo('');
    setSentRate('');
    setGoalId(null);
    setSheet(null);
  }

  function saveRate() {
    const v = parseAmount(rateDraft);
    if (v == null || v <= 0) return;
    setFxRate(v);
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
        <Title>{t('intlTransfers')}</Title>

        <Card>
          <Row
            label={t('fxLabel')}
            value={`1 ${lang === 'ar' ? 'د.إ' : 'AED'} = ${num(fxRate)} ${lang === 'ar' ? 'ج.م' : 'EGP'}`}
            onPress={() => {
              setRateDraft(String(fxRate));
              setSheet('rate');
            }}
          />
          <Caption style={{ marginTop: SPACE.sm }}>{t('fxHint')}</Caption>
        </Card>

        <Card>
          <Title>{t('plannedTransfers')}</Title>
          <Caption>{t('planTfNote')}</Caption>
          {ledger.planTf.length === 0 ? (
            <Body muted style={{ marginTop: SPACE.md }}>{t('noPlanned')}</Body>
          ) : (
            <View style={{ marginTop: SPACE.sm }}>
              {ledger.planTf.map((tf) => (
                <Row
                  key={tf.id}
                  label={tf.day ? `${t('dayOfMonth')} ${tf.day}` : t('plannedTransfers')}
                  value={`${money(tf.amt)} · ${formatEgp(tf.amt * fxRate, lang)}`}
                  onPress={() => removePlannedTransfer(tf.id)}
                />
              ))}
              <Row label={t('total')} value={money(c.planT)} valueColor={p.accentDeep} />
              <Caption style={{ marginTop: SPACE.sm }}>{t('tapToDelete')}</Caption>
            </View>
          )}
          <View style={{ marginTop: SPACE.lg, gap: SPACE.sm }}>
            <Button label={t('addPlanned')} variant="secondary" onPress={() => setSheet('plan')} />
            <Button label={t('sendNow')} onPress={() => setSheet('send')} />
          </View>
        </Card>

        {summary.count > 0 && (
          <Card>
            <Title>{t('transferReport')}</Title>
            <Caption>{t('transferReportNote')}</Caption>
            <View style={{ marginTop: SPACE.sm }}>
              <Row label={t('transferCount')} value={num(summary.count)} />
              <Row label={t('totalSent')} value={money(summary.sent)} />
              <Row label={t('totalDelivered')} value={formatEgp(summary.delivered, lang)} valueColor={p.positive} />
              <Row
                label={t('totalFees')}
                value={`${money(summary.fees)} · ${num(Math.round(summary.feeRate * 1000) / 10)}%`}
                valueColor={summary.fees > 0 ? p.negative : p.sub}
              />
              {yearlyFees > 0 && (
                <Row label={t('yearlyFees')} value={money(yearlyFees)} valueColor={p.warn} />
              )}
              {summary.bestRate != null && summary.worstRate != null && (
                <Row
                  label={t('rateRange')}
                  value={`${num(summary.worstRate)} – ${num(summary.bestRate)}`}
                />
              )}
              {summary.lostToTiming > 0 && (
                <>
                  <Row
                    label={t('lostToTiming')}
                    value={formatEgp(summary.lostToTiming, lang)}
                    valueColor={p.negative}
                  />
                  <Caption style={{ marginTop: SPACE.xs }}>{t('lostToTimingNote')}</Caption>
                </>
              )}
            </View>

            {stats.length > 1 && (
              <View style={{ marginTop: SPACE.lg }}>
                <Caption>{t('byRecipient')}</Caption>
                {stats.map((x) => (
                  <Row
                    key={x.to}
                    label={`${x.to} · ${num(x.count)}×`}
                    value={`${money(x.sent)} → ${formatEgp(x.delivered, lang)}`}
                  />
                ))}
              </View>
            )}
          </Card>
        )}

        <Card>
          <Title>{t('sentTransfers')}</Title>
          {sent.length === 0 ? (
            <Body muted style={{ marginTop: SPACE.md }}>{t('noSent')}</Body>
          ) : (
            <View style={{ marginTop: SPACE.sm }}>
              {sent.map((x) => (
                <View key={x.id}>
                  <Row
                    label={`${formatShortDate(new Date(x.ts), lang)}${x.to ? ` · ${x.to}` : ''}${
                      x.purpose === 'goal' ? ` · ${t('goals')}` : ''
                    }`}
                    value={money(x.amt)}
                    valueColor={p.negative}
                  />
                  {(x.fee || x.rate) && (
                    <Caption>
                      {x.rate ? `${t('rateUsed')} ${num(x.rate)}` : ''}
                      {x.fee ? ` · ${t('totalFees')} ${money(x.fee)}` : ''}
                    </Caption>
                  )}
                </View>
              ))}
            </View>
          )}
        </Card>
      </ScrollView>

      <Sheet
        visible={sheet === 'plan'}
        title={t('addPlanned')}
        onClose={() => setSheet(null)}
        onSubmit={savePlan}
        submitLabel={t('save')}
        canSubmit={(amountVal ?? 0) > 0}
      >
        <Caption>{t('plannedHint')}</Caption>
        <View style={{ height: SPACE.md }} />
        <TextField label={t('enterAmount')} value={amount} onChange={setAmount} numeric big />
        {egpPreview != null && <Body muted>≈ {formatEgp(egpPreview, lang)}</Body>}
        <View style={{ height: SPACE.md }} />
        <DayPicker label={t('dayOfMonth')} value={day} onChange={setDay} />
      </Sheet>

      <Sheet
        visible={sheet === 'send'}
        title={t('sendNow')}
        onClose={() => setSheet(null)}
        onSubmit={doSend}
        submitLabel={t('save')}
        canSubmit={(amountVal ?? 0) > 0}
      >
        <Caption>{t('sendHint')}</Caption>
        <View style={{ height: SPACE.md }} />
        <TextField label={t('enterAmount')} value={amount} onChange={setAmount} numeric big />
        {egpPreview != null && <Body muted>≈ {formatEgp(egpPreview, lang)}</Body>}
        <View style={{ height: SPACE.md }} />
        {ledger.goals.length > 0 && (
          <Chips
            label={t('linkGoal')}
            hint={t('linkGoalHint')}
            value={goalId ?? '__none__'}
            onChange={setGoalId}
            options={goalOptions}
          />
        )}
        <TextField label={t('recipient')} value={to} onChange={setTo} />
        {knownRecipients.length > 0 && (
          <Chips
            value={to}
            onChange={(v) => setTo(v)}
            options={knownRecipients.map((r) => ({ id: r, label: r }))}
          />
        )}
        <TextField label={t('transferFee')} hint={t('transferFeeHint')} value={fee} onChange={setFee} numeric />
        <TextField
          label={t('rateUsed')}
          hint={t('rateUsedHint')}
          value={sentRate}
          onChange={setSentRate}
          numeric
          placeholder={String(fxRate)}
        />
        <TextField label={t('note')} value={note} onChange={setNote} />
      </Sheet>

      <Sheet
        visible={sheet === 'rate'}
        title={t('fxLabel')}
        onClose={() => setSheet(null)}
        onSubmit={saveRate}
        submitLabel={t('save')}
        canSubmit={(parseAmount(rateDraft) ?? 0) > 0}
      >
        <TextField label={t('fxLabel')} hint={t('fxHint')} value={rateDraft} onChange={setRateDraft} numeric big />
      </Sheet>
    </Screen>
  );
}
