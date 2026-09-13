import { useState } from 'react';
import { uuid as newId } from '../src/lib/id';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RestoreBackup } from '../src/components/RestoreBackup';
import { Body, Button, Caption, Card, Row, Screen, Title } from '../src/components/ui';
import { parseAmount } from '../src/domain';
import { useLocalization, usePalette } from '../src/store/selectors';
import { useLedger } from '../src/store/useLedger';
import { FONT, SPACE } from '../src/theme/tokens';

/**
 * Onboarding.
 *
 * The prototype shipped with one specific person's salary, bank balance and
 * goals hardcoded as its starting state — which is why it could not be handed
 * to anyone else. This asks for the three figures the Safe Spend Limit
 * genuinely cannot be computed without, and nothing more: salary, what is in
 * the bank, and what is already committed each month.
 *
 * Everything else has a sensible default and can be filled in later, because
 * an onboarding flow that demands a complete financial picture up front is one
 * people abandon.
 */
export default function OnboardingScreen() {
  const p = usePalette();
  const { t, rtl, money } = useLocalization();
  const insets = useSafeAreaInsets();
  const completeOnboarding = useLedger((s) => s.completeOnboarding);
  const setLang = useLedger((s) => s.setLang);
  const lang = useLedger((s) => s.settings.lang);

  const [salary, setSalary] = useState('');
  const [bank, setBank] = useState('');
  /*
   * Obligations are typed, not assumed.
   *
   * This screen used to add Rent 1,800, Internet 300 and a transfer of 850 to
   * every new ledger after the preview, regardless of what was entered — the
   * author's own figures, presented to a stranger as their own. The preview
   * above the button did not include them either, so the first number the app
   * ever showed was one it then contradicted.
   *
   * Blank stays blank. Nothing here is written unless it was typed.
   */
  const [rent, setRent] = useState('');
  const [internet, setInternet] = useState('');
  const [transfer, setTransfer] = useState('');
  const [commitment, setCommitment] = useState('');
  const [cardStmt, setCardStmt] = useState('');
  const [cardUnbilled, setCardUnbilled] = useState('');
  const [cardInstBal, setCardInstBal] = useState('');
  const [cardInstMo, setCardInstMo] = useState('');

  const salaryVal = parseAmount(salary);
  const bankVal = parseAmount(bank) ?? 0;
  const rentVal = parseAmount(rent) ?? 0;
  const internetVal = parseAmount(internet) ?? 0;
  const transferVal = parseAmount(transfer) ?? 0;
  const commitVal = parseAmount(commitment) ?? 0;
  const oblTotal = rentVal + internetVal + commitVal;
  const stmtVal = parseAmount(cardStmt) ?? 0;
  const unbilledVal = parseAmount(cardUnbilled) ?? 0;
  const instBalVal = parseAmount(cardInstBal) ?? 0;
  const instMoVal = parseAmount(cardInstMo) ?? 0;
  const hasCard = stmtVal > 0 || unbilledVal > 0 || instBalVal > 0 || instMoVal > 0;

  /*
   * What the card takes from the first salary. Nothing has been spent inside
   * the app yet, so every dirham declared here is carried-in balance and the
   * whole revolving amount is charged to this month — the installment plan
   * being the one part that spreads.
   */
  const cardDue = stmtVal + unbilledVal + instMoVal;
  // The preview subtracts exactly what will be written, and nothing else.
  const pool = Math.max(0, (salaryVal ?? 0) - oblTotal - transferVal - cardDue);

  // Salary is the only genuinely required figure: without it there is no cycle
  // to divide, and the whole limit is meaningless.
  const canFinish = salaryVal != null && salaryVal > 0;

  function finish() {
    if (!canFinish || salaryVal == null) return;
    completeOnboarding({
      base: salaryVal,
      bankOpen: bankVal,
      cardSetup: hasCard
        ? { stmt0: stmtVal, unbilled0: unbilledVal, instBal: instBalVal, instMo: instMoVal }
        : null,
      /*
       * A transfer home is the obligation most easily forgotten and the one
       * that most distorts the daily limit when it is, since it leaves in a
       * single lump near the end of the month. So it is asked for — and only
       * recorded when an amount was given.
       */
      planTf: transferVal > 0 ? [{ id: newId(), amt: transferVal, day: 20 }] : [],
      /*
       * Rent and internet are separate lines rather than one lump, because
       * they fall due on different days and are settled separately — which is
       * what the reminders and the planned-versus-actual tracking need in
       * order to say anything useful. Each is written only if it was typed.
       */
      commits: [
        ...(rentVal > 0
          ? [{ id: newId(), ar: 'الإيجار', en: 'Rent', amt: rentVal, day: 1, paused: false, paidMonth: false }]
          : []),
        ...(internetVal > 0
          ? [{ id: newId(), ar: 'الإنترنت', en: 'Internet', amt: internetVal, day: 18, paused: false, paidMonth: false }]
          : []),
        ...(commitVal > 0
          ? [{
              id: newId(),
              ar: 'التزامات أخرى',
              en: 'Other commitments',
              amt: commitVal,
              day: 1,
              paused: false,
              paidMonth: false,
            }]
          : []),
      ],
    });
  }

  const field = (
    label: string,
    hint: string,
    value: string,
    onChange: (s: string) => void,
    autoFocus = false,
  ) => (
    <View style={{ marginBottom: SPACE.xl }}>
      <Body>{label}</Body>
      {hint !== '' && <Caption>{hint}</Caption>}
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        autoFocus={autoFocus}
        placeholder="0"
        placeholderTextColor={p.sub}
        style={[
          styles.input,
          { color: p.ink, borderColor: p.faint, textAlign: rtl ? 'right' : 'left' },
        ]}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: SPACE.lg,
            paddingTop: insets.top + SPACE.xl,
            paddingBottom: SPACE.xxl,
          }}
        >
          <Title style={{ fontSize: FONT.large }}>{t('appName')}</Title>
          <Caption style={{ marginTop: SPACE.sm }}>{t('sslDesc')}</Caption>

          <View style={{ marginTop: SPACE.lg, marginBottom: SPACE.xl }}>
            <Button
              label={lang === 'ar' ? 'English' : 'العربية'}
              variant="secondary"
              onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            />
          </View>

          {/* Restore comes FIRST. Anyone with existing history should not have
              to type three figures they are about to overwrite anyway. */}
          <RestoreBackup />

          <Caption style={{ marginVertical: SPACE.lg }}>{t('orStartFresh')}</Caption>

          <Card>
            {field(t('salaryWork'), t('salaryHint'), salary, setSalary, true)}
            {field(t('bankAcct'), t('bankHint'), bank, setBank)}
          </Card>

          <Card>
            <Title>{t('obOblT')}</Title>
            <Caption>{t('obOblNote')}</Caption>
            {field(t('obRent'), t('obRentHint'), rent, setRent)}
            {field(t('obInternet'), t('obInternetHint'), internet, setInternet)}
            {field(t('obTransfer'), t('obTransferHint'), transfer, setTransfer)}
            {field(t('obOther'), t('commitHint'), commitment, setCommitment)}
          </Card>

          {/*
            The card is asked for up front rather than left to a settings
            screen. Skipping it does not make the limit safer — it makes it
            wrong in the generous direction, which is the failure mode that
            actually costs money.
          */}
          <Card>
            <Title>{t('creditCard')}</Title>
            <Caption>{t('obCardSkip')}</Caption>
            {field(t('stmtRem'), t('startCardHint'), cardStmt, setCardStmt)}
            {field(t('unbilled'), '', cardUnbilled, setCardUnbilled)}
            {field(t('instBal'), '', cardInstBal, setCardInstBal)}
            {field(t('instMo'), '', cardInstMo, setCardInstMo)}
          </Card>

          {canFinish && (
            <Card>
              <Title>{t('obPreviewT')}</Title>
              <View style={{ marginTop: SPACE.sm }}>
                <Row label={t('salaryWork')} value={money(salaryVal)} />
                {oblTotal > 0 && <Row label={t('segCommit')} value={`− ${money(oblTotal)}`} />}
                {transferVal > 0 && (
                  <Row label={t('obTransfer')} value={`− ${money(transferVal)}`} />
                )}
                {cardDue > 0 && (
                  <Row
                    label={t('cardDueLabel')}
                    value={`− ${money(cardDue)}`}
                    valueColor={p.negative}
                  />
                )}
                <Row label={t('livingPool')} value={money(pool)} valueColor={p.ink} />
              </View>
              <Body style={{ fontSize: FONT.large, fontWeight: '700', color: p.accent, marginTop: SPACE.md }}>
                {money(pool / 30)} / {t('perDay')}
              </Body>
              {instBalVal > 0 && instMoVal <= 0 && (
                <Caption style={{ color: p.warn, marginTop: SPACE.sm }}>{t('instUnknownB')}</Caption>
              )}
              <Caption style={{ marginTop: SPACE.sm }}>{t('obLater')}</Caption>
            </Card>
          )}

          <Button label={t('start')} onPress={finish} disabled={!canFinish} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    fontSize: FONT.large,
    fontWeight: '700',
    borderBottomWidth: 1,
    paddingVertical: SPACE.sm,
    marginTop: SPACE.sm,
  },
});
