import { ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Caption, Card, Row, Screen, Title } from '../../src/components/ui';
import { isSupabaseConfigured } from '../../src/lib/supabase';
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
  const { t, lang, money, num } = useLocalization();
  const insets = useSafeAreaInsets();

  const c = useSafeSpend();
  const cc = useCardPosition();
  const sv = useSavingSummary();

  const settings = useLedger((s) => s.settings);
  const setLang = useLedger((s) => s.setLang);
  const setTheme = useLedger((s) => s.setTheme);
  const setBiometricLock = useLedger((s) => s.setBiometricLock);
  const reset = useLedger((s) => s.reset);

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
          <Title>{t('creditCard')}</Title>
          <Row label={t('cardOut')} value={money(cc.out)} valueColor={p.negative} />
          <Row label={t('stmtRem')} value={money(cc.stmtRem)} />
          <Row label={t('unbilled')} value={money(cc.unbilled)} />
          <Row label={t('instBal')} value={money(cc.instBal)} />
          <Row
            label={t('availCard')}
            value={money(cc.avail)}
            valueColor={cc.avail > 0 ? p.positive : p.negative}
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

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACE.md }}>
            <Body>{t('biometricLock')}</Body>
            <Switch
              value={settings.biometricLock}
              onValueChange={setBiometricLock}
              trackColor={{ true: p.accent, false: p.faint }}
              accessibilityLabel={t('biometricLock')}
            />
          </View>
        </Card>

        <Card>
          <Title>{t('cloudT')}</Title>
          {isSupabaseConfigured ? (
            <Caption>{t('cloudReady')}</Caption>
          ) : (
            // Not an error state: Masari is designed to be fully usable with no
            // account and no network at all.
            <Caption>{t('cloudOffline')}</Caption>
          )}
        </Card>

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
