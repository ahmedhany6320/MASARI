import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { signIn, signOut, signUp, useAuth } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import { pullLedger, pushLedger } from '../lib/sync';
import { useLocalization, usePalette } from '../store/selectors';
import { useLedger } from '../store/useLedger';
import { FONT, SPACE } from '../theme/tokens';
import { Body, Button, Caption, Card, Row, Title } from './ui';

/**
 * Cloud sync and account.
 *
 * Sync is strictly additive here: with no backend configured, or nobody signed
 * in, the app carries on working entirely offline. That is why this renders a
 * plain explanation rather than an error when Supabase is absent.
 */
export function CloudSync() {
  const p = usePalette();
  const { t, rtl } = useLocalization();
  const { user, loading } = useAuth();

  const ledger = useLedger((s) => s.ledger);
  const settings = useLedger((s) => s.settings);
  const replaceAll = useLedger((s) => s.replaceAll);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  if (!isSupabaseConfigured) {
    return (
      <Card>
        <Title>{t('cloudT')}</Title>
        <Caption>{t('cloudOffline')}</Caption>
      </Card>
    );
  }

  async function doSignIn(mode: 'in' | 'up') {
    setBusy(true);
    try {
      const res = mode === 'in' ? await signIn(email, password) : await signUp(email, password);
      if (!res.ok) {
        Alert.alert(t('cloudT'), res.error ?? t('syncFailed'));
        return;
      }
      if (res.needsConfirmation) Alert.alert(t('cloudT'), t('confirmEmail'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function doPush() {
    setBusy(true);
    try {
      const res = await pushLedger(ledger, {
        lang: settings.lang,
        theme: settings.theme,
        fxRate: settings.fxRate,
        onboarded: settings.onboarded,
      });
      if (!res.ok) {
        Alert.alert(t('cloudT'), res.error ?? t('syncFailed'));
        return;
      }
      setLastSync(new Date().toLocaleString(settings.lang === 'ar' ? 'ar-EG' : 'en-GB'));
      if (res.skipped) Alert.alert(t('cloudT'), `${t('syncSkipped')} ${res.skipped}`);
    } finally {
      setBusy(false);
    }
  }

  async function doPull() {
    setBusy(true);
    try {
      const { result, error } = await pullLedger();
      if (error) {
        Alert.alert(t('cloudT'), error);
        return;
      }
      if (!result) {
        Alert.alert(t('cloudT'), t('cloudEmpty'));
        return;
      }
      // Overwriting the device is the one destructive operation here, so it is
      // always confirmed — never silent.
      Alert.alert(t('pullConfirmT'), t('pullConfirmS'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('cloudPull'),
          style: 'destructive',
          onPress: () => {
            replaceAll(result.ledger, result.settings);
            setLastSync(new Date().toLocaleString(settings.lang === 'ar' ? 'ar-EG' : 'en-GB'));
          },
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const input = (
    value: string,
    onChange: (s: string) => void,
    placeholder: string,
    secure = false,
  ) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={p.sub}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={secure ? 'default' : 'email-address'}
      secureTextEntry={secure}
      style={{
        fontSize: FONT.body,
        color: p.ink,
        borderBottomWidth: 1,
        borderColor: p.faint,
        paddingVertical: SPACE.sm,
        marginTop: SPACE.sm,
        textAlign: rtl ? 'right' : 'left',
      }}
      accessibilityLabel={placeholder}
    />
  );

  return (
    <Card>
      <Title>{t('cloudT')}</Title>

      {loading ? (
        <Caption>{t('loading')}</Caption>
      ) : user ? (
        <>
          <Caption>{t('signedInAs')}</Caption>
          <Body>{user.email}</Body>
          {lastSync && <Row label={t('lastSync')} value={lastSync} />}
          <View style={{ marginTop: SPACE.md, gap: SPACE.sm }}>
            <Button label={t('cloudPush')} onPress={() => void doPush()} disabled={busy} />
            <Button label={t('cloudPull')} variant="secondary" onPress={() => void doPull()} disabled={busy} />
            <Button label={t('signOut')} variant="secondary" onPress={() => void signOut()} disabled={busy} />
          </View>
        </>
      ) : (
        <>
          <Caption>{t('cloudIntroNative')}</Caption>
          {input(email, setEmail, t('emailPh'))}
          {input(password, setPassword, t('passwordPh'), true)}
          <View style={{ marginTop: SPACE.md, gap: SPACE.sm }}>
            <Button label={t('signIn')} onPress={() => void doSignIn('in')} disabled={busy || !email || !password} />
            <Button
              label={t('signUp')}
              variant="secondary"
              onPress={() => void doSignIn('up')}
              disabled={busy || !email || !password}
            />
          </View>
        </>
      )}
    </Card>
  );
}
