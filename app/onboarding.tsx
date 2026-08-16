import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RestoreBackup } from '../src/components/RestoreBackup';
import { Body, Button, Caption, Card, Screen, Title } from '../src/components/ui';
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
  const [commitment, setCommitment] = useState('');

  const salaryVal = parseAmount(salary);
  const bankVal = parseAmount(bank) ?? 0;
  const commitVal = parseAmount(commitment) ?? 0;

  // Salary is the only genuinely required figure: without it there is no cycle
  // to divide, and the whole limit is meaningless.
  const canFinish = salaryVal != null && salaryVal > 0;

  function finish() {
    if (!canFinish || salaryVal == null) return;
    completeOnboarding({
      base: salaryVal,
      bankOpen: bankVal,
      commits:
        commitVal > 0
          ? [
              {
                id: 'seed_commit',
                ar: 'التزامات شهرية',
                en: 'Monthly commitments',
                amt: commitVal,
                day: 1,
                paused: false,
                paidMonth: false,
              },
            ]
          : [],
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
      <Caption>{hint}</Caption>
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
            {field(t('segCommit'), t('commitHint'), commitment, setCommitment)}
          </Card>

          {canFinish && (
            <Card>
              <Caption>{t('livingPool')}</Caption>
              <Body style={{ fontSize: FONT.large, fontWeight: '700', color: p.accent }}>
                {money(Math.max(0, salaryVal - commitVal))}
              </Body>
              <Caption style={{ marginTop: SPACE.sm }}>{t('sslNote')}</Caption>
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
