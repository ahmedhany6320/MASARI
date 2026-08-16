import { Alert, View } from 'react-native';
import { hasSeed, loadSeed, SEED_DATE } from '../data/seed';
import { formatShortDate } from '../i18n';
import { useLocalization, usePalette } from '../store/selectors';
import { useLedger } from '../store/useLedger';
import { RADIUS, SPACE } from '../theme/tokens';
import { Body, Button, Caption, Title } from './ui';

/**
 * Offers the bundled backup when the ledger is empty.
 *
 * This exists because putting the restore button only in onboarding hid it
 * from exactly the people who needed it: anyone already past onboarding — an
 * upgrade, or a first run that was skipped — never sees that screen again, and
 * the button in settings is several scrolls down. An empty ledger on the main
 * screen is the moment to offer it, so it is offered there.
 *
 * It disappears the instant there is real data, so it can never nag someone
 * who has started entering their own.
 */
export function SeedBanner() {
  const p = usePalette();
  const { t, num, lang } = useLocalization();
  const ledger = useLedger((s) => s.ledger);
  const replaceAll = useLedger((s) => s.replaceAll);

  // "Empty" means nothing has actually been recorded — a salary alone, typed
  // during onboarding, still counts as empty for this purpose.
  const isEmpty = ledger.tx.length === 0;
  if (!hasSeed || !isEmpty) return null;

  const seed = loadSeed();

  function apply() {
    Alert.alert(t('seedT'), t('seedConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('seedBtn'),
        onPress: () => {
          replaceAll(seed.ledger, {
            lang: seed.settings.lang,
            theme: seed.settings.theme,
            fxRate: seed.settings.fxRate,
            onboarded: true,
          });
        },
      },
    ]);
  }

  return (
    <View
      style={{
        backgroundColor: p.accentWash,
        borderColor: p.accent,
        borderWidth: 1,
        borderRadius: RADIUS.lg,
        padding: SPACE.lg,
        marginBottom: SPACE.md,
      }}
    >
      <Title>{t('seedT')}</Title>
      <Body muted>{t('seedBannerBody')}</Body>
      <Caption style={{ marginTop: SPACE.sm }}>
        {t('seedFrom')} {formatShortDate(SEED_DATE, lang)} · {num(seed.counts.transactions)} {t('navTx')}
      </Caption>
      <View style={{ marginTop: SPACE.md }}>
        <Button label={t('seedBtn')} onPress={apply} />
      </View>
    </View>
  );
}
