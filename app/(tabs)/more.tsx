import { router } from 'expo-router';
import { ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudSync } from '../../src/components/CloudSync';
import { NotificationSettings } from '../../src/components/NotificationSettings';
import { Body, Button, Caption, Card, Row, Screen, Title } from '../../src/components/ui';
import {
  useCardPosition,
  useLocalization,
  usePalette,
  useSafeSpend,
  useSavingSummary,
} from '../../src/store/selectors';
import { useLedger } from '../../src/store/useLedger';
import { SPACE } from '../../src/theme/tokens';

/**
 * More — settings, the card, and the month's report.
 *
 * The prototype nested eight sub-screens under here; this collects the ones
 * that carry real information into a single scroll, which is cheaper to read
 * than a menu of menus.
 */
export default function MoreScreen() {
  const p = usePalette();
  const { t, lang, money, num, rtl } = useLocalization();
  const insets = useSafeAreaInsets();

  const c = useSafeSpend();
  const cc = useCardPosition();
  const sv = useSavingSummary();

  const ledger = useLedger((s) => s.ledger);
  const settings = useLedger((s) => s.settings);
  const setLang = useLedger((s) => s.setLang);
  const setTheme = useLedger((s) => s.setTheme);
  const setBiometricLock = useLedger((s) => s.setBiometricLock);
  const reset = useLedger((s) => s.reset);

  // Expected money still outstanding: receivables plus anything lent out.
  const pendingRecv =
    ledger.recv.filter((r) => r.status !== 'received').reduce((a, r) => a + r.amt, 0) +
    ledger.people.filter((x) => x.dir === 'owed' && x.out > 0).reduce((a, x) => a + x.out, 0);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: SPACE.lg,
          paddingTop: insets.top + SPACE.lg,
          paddingBottom: SPACE.xxl,
        }}
      >
        <Title>{t('navMore')}</Title>

        <View style={{ height: SPACE.lg }} />

        <Card>
          <Title>{t('manage')}</Title>
          <Row
            label={t('salaryWork')}
            value={money(ledger.base)}
            onPress={() => router.push('/salary')}
          />
          <Row
            label={t('creditCard')}
            value={cc.out > 0 ? money(cc.out) : t('cardSetupT')}
            valueColor={cc.out > 0 ? p.negative : p.sub}
            onPress={() => router.push('/card')}
          />
          <Row
            label={t('intlTransfers')}
            value={c.planT > 0 ? money(c.planT) : '—'}
            onPress={() => router.push('/transfers')}
          />
          <Row
            label={t('expMoneyLong')}
            value={pendingRecv > 0 ? `≈ ${money(pendingRecv)}` : '—'}
            valueColor={pendingRecv > 0 ? p.warn : p.sub}
            onPress={() => router.push('/receivables')}
          />
        </Card>

        <Card>
          <Title>{t('report')}</Title>
          <Row label={t('income')} value={money(sv.incomeM)} valueColor={p.positive} />
          <Row label={t('monthSpend')} value={money(sv.spendM)} valueColor={p.negative} />
          <Row
            label={t('saved')}
            value={money(sv.actual)}
            valueColor={sv.actual >= 0 ? p.positive : p.negative}
          />
          {sv.short != null && sv.short > 0 && (
            <Row label={t('shortfall')} value={money(sv.short)} valueColor={p.warn} />
          )}
          {sv.extra != null && sv.extra > 0 && (
            <Row label={t('extraSavings')} value={money(sv.extra)} valueColor={p.positive} />
          )}
          <Caption style={{ marginTop: SPACE.sm }}>
            {num(c.daysLeft)} {t('dayW')}
          </Caption>
        </Card>

        <NotificationSettings />

        <Card>
          <Title>{t('settings')}</Title>
          <Row
            label={t('language')}
            value={lang === 'ar' ? 'العربية' : 'English'}
            onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          />
          <Row
            label={t('theme')}
            value={settings.theme === 'dark' ? t('dark') : t('light')}
            onPress={() => setTheme(settings.theme === 'dark' ? 'light' : 'dark')}
          />
          <Row label={t('fxLabel')} value={num(settings.fxRate)} />

          <View style={{ paddingVertical: SPACE.md }}>
            <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.md }}>
              <Body style={{ flexShrink: 1 }}>{t('biometricLock')}</Body>
              <Switch
                value={settings.biometricLock}
                onValueChange={setBiometricLock}
                trackColor={{ true: p.accent, false: p.faint }}
                accessibilityLabel={t('biometricLock')}
              />
            </View>
            <Caption>{t('biometricHint')}</Caption>
          </View>
        </Card>

        <CloudSync />

        <Card>
          <Title>{t('dataBackup')}</Title>
          <Caption>{t('resetS')}</Caption>
          <View style={{ marginTop: SPACE.md }}>
            <Button label={t('resetBtn')} variant="secondary" onPress={reset} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
