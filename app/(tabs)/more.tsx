import { router } from 'expo-router';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudSync } from '../../src/components/CloudSync';
import { NotificationSettings } from '../../src/components/NotificationSettings';
import { ExportBackup } from '../../src/components/ExportBackup';
import { RestoreBackup } from '../../src/components/RestoreBackup';
import { Tile, TileGrid } from '../../src/components/Tiles';
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
import { version as APP_VERSION } from '../../package.json';

/**
 * More — the hub.
 *
 * Built from large tiles rather than list rows: this is used one-handed and
 * often standing, and each tile carries its own live figure so most questions
 * are answered without opening anything.
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
  const setSslBasis = useLedger((s) => s.setSslBasis);
  const basis = useLedger((s) => s.ledger.sslBasis ?? 'salary');

  // Expected money still outstanding: receivables plus anything lent out.
  const pendingRecv =
    ledger.recv.filter((r) => r.status !== 'received').reduce((a, r) => a + r.amt, 0) +
    ledger.people.filter((x) => x.dir === 'owed' && x.out > 0).reduce((a, x) => a + x.out, 0);

  // Things that need attention, surfaced as tile badges rather than buried.
  const cardNeedsSetup = ledger.cardSetup == null && ledger.cardCfg.limit === 0;
  const goalNeedsDeadline = ledger.goals.some((g) => g.target != null && g.months == null);
  const salaryPending = ledger.salStatus !== 'received';

  /*
   * Erasing everything is irreversible and sits one tap from ordinary
   * settings, so it confirms first — and the confirmation names the backup
   * section sitting directly above it on this same screen. Afterwards it sends
   * the user to onboarding rather than leaving them on a settings screen full
   * of zeroes.
   */
  function confirmReset() {
    Alert.alert(t('resetConfirmT'), t('resetConfirmB'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('resetGo'),
        style: 'destructive',
        onPress: () => {
          reset();
          Alert.alert(t('resetDoneT'), t('resetDoneB'));
          router.replace('/onboarding');
        },
      },
    ]);
  }

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

        <TileGrid>
          <Tile
            icon="📊"
            label={t('insights')}
            value={money(c.livingPool)}
            valueColor={p.accent}
            hint={t('insightsHint')}
            onPress={() => router.push('/insights')}
            badge={goalNeedsDeadline}
          />
          <Tile
            icon="💼"
            label={t('salaryWork')}
            value={money(ledger.base)}
            hint={salaryPending ? t('expectedStatus') : t('received')}
            onPress={() => router.push('/salary')}
            badge={salaryPending}
          />
          <Tile
            icon="💳"
            label={t('creditCard')}
            value={cardNeedsSetup ? t('cardSetupT') : money(cc.out)}
            valueColor={cc.out > 0 ? p.negative : p.sub}
            hint={cardNeedsSetup ? undefined : `${t('availCard')} ${money(cc.avail)}`}
            onPress={() => router.push('/card')}
            badge={cardNeedsSetup}
          />
          <Tile
            icon="🌍"
            label={t('intlTransfers')}
            value={c.planT > 0 ? money(c.planT) : '—'}
            hint={`${num(settings.fxRate)} ${lang === 'ar' ? 'ج.م' : 'EGP'}`}
            onPress={() => router.push('/transfers')}
          />
          <Tile
            icon="⏳"
            label={t('expMoneyLong')}
            value={pendingRecv > 0 ? `≈ ${money(pendingRecv)}` : '—'}
            valueColor={pendingRecv > 0 ? p.warn : p.sub}
            hint={t('notCounted')}
            onPress={() => router.push('/receivables')}
          />
          <Tile
            icon="🎯"
            label={t('goals')}
            value={c.goalReq > 0 ? money(c.goalReq) : '—'}
            valueColor={c.goalReq > 0 ? p.accentDeep : p.sub}
            hint={goalNeedsDeadline ? t('noDeadlineShort') : undefined}
            onPress={() => router.push('/goal-plan')}
            badge={goalNeedsDeadline}
          />
          <Tile
            icon="🔄"
            label={t('startTodayT')}
            hint={t('startTodayTileHint')}
            onPress={() => router.push('/start-today')}
          />
        </TileGrid>

        <View style={{ height: SPACE.lg }} />

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
          <Row
            label={t('fxLabel')}
            value={num(settings.fxRate)}
            onPress={() => router.push('/transfers')}
          />

          <View style={{ paddingVertical: SPACE.md }}>
            <View
              style={{
                flexDirection: rtl ? 'row-reverse' : 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: SPACE.md,
              }}
            >
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

        {/*
          The single most consequential setting in the app: it changes what
          the daily limit is derived from. Both options are correct in their
          own situation, so it explains rather than defaults silently.
        */}
        <Card>
          <Title>{t('basisT')}</Title>
          <View style={{ marginTop: SPACE.md, gap: SPACE.sm }}>
            <Button
              label={t('basisSalary')}
              variant={basis === 'salary' ? 'primary' : 'secondary'}
              onPress={() => setSslBasis('salary')}
            />
            <Caption>{t('basisSalaryNote')}</Caption>
            <Button
              label={t('basisBalance')}
              variant={basis === 'balance' ? 'primary' : 'secondary'}
              onPress={() => setSslBasis('balance')}
            />
            <Caption>{t('basisBalanceNote')}</Caption>
            <Button
              label={t('basisGoal')}
              variant={basis === 'goal' ? 'primary' : 'secondary'}
              onPress={() => setSslBasis('goal')}
            />
            <Caption>{t('basisGoalNote')}</Caption>
            {basis === 'goal' && goalNeedsDeadline && (
              <Caption style={{ color: p.warn }}>{t('planNeedTarget')}</Caption>
            )}
          </View>
        </Card>

        <CloudSync />

        <ExportBackup />

        <RestoreBackup />

        {/*
          Stamped from package.json at build time. Without it there is no way
          to tell a device running the new bundle from one still serving a
          cached old one, which turns every "it did not change" into guesswork.
        */}
        <Card>
          <Title>{t('buildT')}</Title>
          <View style={{ marginTop: SPACE.sm }}>
            <Row label={t('appName')} value={`v${APP_VERSION}`} valueColor={p.accentDeep} />
          </View>
          <Caption style={{ marginTop: SPACE.sm }}>{t('buildNote')}</Caption>
        </Card>

        <Card>
          <Title>{t('resetT')}</Title>
          <Caption>{t('resetS')}</Caption>
          <View style={{ marginTop: SPACE.md }}>
            <Button label={t('resetBtn')} variant="secondary" onPress={confirmReset} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
