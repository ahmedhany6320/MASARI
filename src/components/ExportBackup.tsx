import { useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { backupFilename, backupToText, summarizeBackup } from '../domain';
import { useLocalization, usePalette } from '../store/selectors';
import { useLedger } from '../store/useLedger';
import { SPACE } from '../theme/tokens';
import { Sheet, TextField } from './fields';
import { Body, Button, Caption, Card, Row, Title } from './ui';

/**
 * Backup export.
 *
 * Offers two routes because they fail in different situations: the system
 * share sheet is the convenient path, and a plain readable box is the fallback
 * for when there is no app to share into — or when the user simply wants to
 * paste the text somewhere themselves.
 *
 * Uses React Native's built-in `Share` rather than a file-system dependency:
 * the payload is small text, and this works in Expo Go with no extra native
 * module.
 */
export function ExportBackup() {
  const p = usePalette();
  const { t, num } = useLocalization();
  const ledger = useLedger((s) => s.ledger);
  const settings = useLedger((s) => s.settings);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  function build(): string {
    return backupToText(ledger, {
      lang: settings.lang,
      theme: settings.theme,
      fxRate: settings.fxRate,
    });
  }

  async function share() {
    const body = build();
    try {
      await Share.share({ message: body, title: backupFilename() });
    } catch {
      // Sharing can be cancelled or unavailable; falling back to the readable
      // box means the user still gets their data either way.
      setText(body);
      setOpen(true);
    }
  }

  function show() {
    setText(build());
    setOpen(true);
  }

  const summary = text ? summarizeBackup(text, ledger) : null;

  return (
    <>
      <Card>
        <Title>{t('exportT')}</Title>
        <Caption>{t('exportNote')}</Caption>
        <View style={{ marginTop: SPACE.md, gap: SPACE.sm }}>
          <Button label={t('exportShare')} onPress={() => void share()} />
          <Button label={t('exportShow')} variant="secondary" onPress={show} />
        </View>
      </Card>

      <Sheet
        visible={open}
        title={t('exportT')}
        onClose={() => setOpen(false)}
        onSubmit={() => {
          Alert.alert(t('exportT'), t('exportCopyHint'));
        }}
        submitLabel={t('exportHowCopy')}
      >
        {summary && (
          <View style={{ marginBottom: SPACE.md }}>
            <Row label={t('navTx')} value={num(summary.transactions)} />
            <Row label={t('segPeople')} value={num(summary.people)} />
            <Row label={t('goals')} value={num(summary.goals)} />
            <Row label={t('fileSize')} value={`${summary.sizeKb} KB`} valueColor={p.sub} />
          </View>
        )}
        <Body muted>{t('exportSelectHint')}</Body>
        <View style={{ height: SPACE.sm }} />
        <TextField label={t('backupText')} value={text} onChange={() => {}} multiline />
      </Sheet>
    </>
  );
}
