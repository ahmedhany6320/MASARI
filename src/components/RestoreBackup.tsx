import { useState } from 'react';
import { Alert, View } from 'react-native';
import { parseBackup, type ImportResult } from '../domain';
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
  const { t, num } = useLocalization();
  const replaceAll = useLedger((s) => s.replaceAll);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);

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
        onPress: () => {
          replaceAll(preview.ledger, {
            lang: preview.settings.lang,
            theme: preview.settings.theme,
            fxRate: preview.settings.fxRate,
            // A restored ledger is by definition already set up.
            onboarded: true,
          });
          setPreview(null);
          setText('');
          setOpen(false);
          Alert.alert(t('restoreT'), t('restoreDone'));
        },
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
        <View style={{ marginTop: SPACE.md }}>
          <Button label={t('restoreBtn')} variant="secondary" onPress={() => setOpen(true)} />
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
