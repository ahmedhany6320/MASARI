import { useState } from 'react';
import { Alert, View } from 'react-native';
import { hasSeed, loadSeed, SEED_DATE } from '../data/seed';
import { parseBackup, type ImportResult } from '../domain';
import { formatShortDate } from '../i18n';
import { useLocalization, usePalette } from '../store/selectors';
import { useLedger } from '../store/useLedger';
import { SPACE } from '../theme/tokens';
import { Sheet, TextField } from './fields';
import { Body, Button, Caption, Card, Row, Title } from './ui';

/**
 * Restore from a backup exported by the original PWA.
 *
 * Paste-based rather than file-picker based on purpose: it needs no extra
 * native permission, works identically on every platform including Expo Go,
 * and the old app's backup feature already produced text meant to be copied.
 *
 * The import is previewed before it is applied — restoring is destructive, and
 * showing counts first turns "trust me" into "here is exactly what you are
 * about to get".
 */
export function RestoreBackup() {
  const p = usePalette();
  const { t, num, lang } = useLocalization();
  const replaceAll = useLedger((s) => s.replaceAll);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);

  /** Applies an already-parsed import after confirming. */
  function applyResult(res: ImportResult, doneMessage: string) {
    replaceAll(res.ledger, {
      lang: res.settings.lang,
      theme: res.settings.theme,
      fxRate: res.settings.fxRate,
      // A restored ledger is by definition already set up.
      onboarded: true,
    });
    setPreview(null);
    setText('');
    setOpen(false);
    Alert.alert(t('restoreT'), doneMessage);
  }

  function useBundled() {
    const res = loadSeed();
    Alert.alert(
      t('seedT'),
      `${t('seedConfirm')}\n\n${t('navTx')}: ${num(res.counts.transactions)}`,
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('seedBtn'), onPress: () => applyResult(res, t('restoreDone')) },
      ],
    );
  }

  function check() {
    const res = parseBackup(text);
    if (!res) {
      Alert.alert(t('restoreT'), t('restoreInvalid'));
      return;
    }
    setPreview(res);
  }

  function apply() {
    if (!preview) return;
    Alert.alert(t('restoreT'), t('restoreConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('restoreBtn'),
        style: 'destructive',
        onPress: () => applyResult(preview, t('restoreDone')),
      },
    ]);
  }

  function close() {
    setOpen(false);
    setPreview(null);
    setText('');
  }

  return (
    <>
      <Card>
        <Title>{t('restoreT')}</Title>
        <Caption>{t('restoreNote')}</Caption>

        {hasSeed && (
          <View style={{ marginTop: SPACE.md }}>
            {/* The common case gets the primary button: the bundled backup is
                already inside the app, so this is one tap with nothing to
                copy, paste or find. */}
            <Button label={t('seedBtn')} onPress={useBundled} />
            <Caption style={{ marginTop: SPACE.sm }}>
              {t('seedFrom')} {formatShortDate(SEED_DATE, lang)} · {num(loadSeed().counts.transactions)}{' '}
              {t('navTx')}
            </Caption>
          </View>
        )}

        <View style={{ marginTop: SPACE.md }}>
          <Button label={t('pasteBackup')} variant="secondary" onPress={() => setOpen(true)} />
        </View>
      </Card>

      <Sheet
        visible={open}
        title={t('restoreT')}
        onClose={close}
        onSubmit={preview ? apply : check}
        submitLabel={preview ? t('restoreBtn') : t('checkBackup')}
        canSubmit={text.trim().length > 0}
      >
        <Caption>{t('restoreHow')}</Caption>
        <View style={{ height: SPACE.md }} />
        <TextField
          label={t('backupText')}
          value={text}
          onChange={(v) => {
            setText(v);
            setPreview(null);
          }}
          multiline
          placeholder='{"__v":1,...}'
        />

        {preview && (
          <View style={{ marginTop: SPACE.md }}>
            <Body style={{ color: p.positive }}>{t('backupValid')}</Body>
            <Row label={t('navTx')} value={num(preview.counts.transactions)} />
            <Row label={t('segCommit')} value={num(preview.counts.commitments)} />
            <Row label={t('segPeople')} value={num(preview.counts.people)} />
            <Row label={t('goals')} value={num(preview.counts.goals)} />
            <Row label={t('expMoney')} value={num(preview.counts.receivables)} />
            <Row label={t('overtime')} value={num(preview.counts.overtime)} />
            {preview.warnings.length > 0 && (
              <Caption style={{ color: p.warn, marginTop: SPACE.sm }}>
                {t('restoreWarnings')} {preview.warnings.join(', ')}
              </Caption>
            )}
          </View>
        )}
      </Sheet>
    </>
  );
}
