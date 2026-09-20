import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { parseAmount, type Account } from '../domain';
import { useLocalization, usePalette } from '../store/selectors';
import { useLedger } from '../store/useLedger';
import { FONT, RADIUS, SPACE } from '../theme/tokens';
import { Body, Button, Caption, Title } from './ui';

const ACCOUNTS: Account[] = ['card', 'bank', 'cash'];

/**
 * Quick-add: record a spend in as few taps as possible.
 *
 * Recording an expense is the single most frequent thing anyone does in this
 * app, and it usually happens standing at a till. So the amount field is
 * focused immediately, the account defaults to the card (where day-to-day
 * spending actually happens), and a category is optional — an uncategorised
 * expense that got recorded beats a categorised one the user gave up on.
 */
export function QuickAdd({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const p = usePalette();
  const { t, lang, rtl, money } = useLocalization();
  const cats = useLedger((s) => s.ledger.cats);
  const rules = useLedger((s) => s.ledger.rules);
  const spend = useLedger((s) => s.spend);
  const learnRule = useLedger((s) => s.learnRule);

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [catId, setCatId] = useState<string | null>(null);
  const [acct, setAcct] = useState<Account>('card');

  const parsed = useMemo(() => parseAmount(amount), [amount]);
  const valid = parsed != null && parsed > 0;

  // A merchant the user has categorised before pre-selects its category, so
  // the same coffee shop only has to be filed once.
  const suggested = useMemo(() => {
    const key = merchant.trim().toLowerCase();
    return key ? (rules[key] ?? null) : null;
  }, [merchant, rules]);

  const effectiveCat = catId ?? suggested;

  function reset() {
    setAmount('');
    setMerchant('');
    setCatId(null);
    setAcct('card');
  }

  function submit() {
    if (!valid || parsed == null) return;
    spend({ amt: parsed, cat: effectiveCat, acct, memo: merchant.trim() || undefined });
    // Only remember the mapping when the user picked it themselves — echoing
    // back a suggestion the app made would let one mistake harden into a rule.
    if (merchant.trim() && catId) learnRule(merchant, catId);
    reset();
    onClose();
  }

  const accountLabel: Record<Account, string> = {
    card: t('creditCard'),
    bank: t('bankAcct'),
    cash: t('cashAcct'),
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('cancel')} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
      >
        <View style={[styles.sheet, { backgroundColor: p.surface, borderColor: p.faint }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Title>{t('addExpense')}</Title>

            <Caption style={{ marginTop: SPACE.lg }}>{t('enterAmount')}</Caption>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              autoFocus
              placeholder="0"
              placeholderTextColor={p.sub}
              style={[
                styles.amountInput,
                { color: p.ink, borderColor: p.faint, textAlign: rtl ? 'right' : 'left' },
              ]}
              accessibilityLabel={t('enterAmount')}
            />

            <Caption style={{ marginTop: SPACE.lg }}>{t('merchant')}</Caption>
            <TextInput
              value={merchant}
              onChangeText={setMerchant}
              placeholder={t('merchantPh')}
              placeholderTextColor={p.sub}
              style={[
                styles.input,
                { color: p.ink, borderColor: p.faint, textAlign: rtl ? 'right' : 'left' },
              ]}
              accessibilityLabel={t('merchant')}
            />

            <Caption style={{ marginTop: SPACE.lg }}>{t('account')}</Caption>
            <View style={[styles.chips, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
              {ACCOUNTS.map((a) => {
                const on = acct === a;
                return (
                  <Pressable
                    key={a}
                    onPress={() => setAcct(a)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[
                      styles.chip,
                      { borderColor: on ? p.accent : p.faint, backgroundColor: on ? p.accentWash : 'transparent' },
                    ]}
                  >
                    <Text style={{ color: on ? p.accentDeep : p.ink, fontSize: FONT.small }}>
                      {accountLabel[a]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Caption style={{ marginTop: SPACE.lg }}>{t('category')}</Caption>
            <View style={[styles.chips, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
              {cats.map((cat) => {
                const on = effectiveCat === cat.id;
                return (
                  <Pressable
                    key={cat.id}
                    onPress={() => setCatId(on ? null : cat.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[
                      styles.chip,
                      { borderColor: on ? p.accent : p.faint, backgroundColor: on ? p.accentWash : 'transparent' },
                    ]}
                  >
                    <Text style={{ color: on ? p.accentDeep : p.ink, fontSize: FONT.small }}>
                      {cat[lang]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {valid && parsed != null && (
              <Body muted style={{ marginTop: SPACE.lg }}>
                {money(parsed)}
              </Body>
            )}

            <View style={{ marginTop: SPACE.lg, gap: SPACE.sm }}>
              <Button label={t('add')} onPress={submit} disabled={!valid} />
              <Button label={t('cancel')} variant="secondary" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACE.lg,
    maxHeight: '88%',
  },
  amountInput: {
    fontSize: FONT.large,
    fontWeight: '700',
    borderBottomWidth: 1,
    paddingVertical: SPACE.sm,
  },
  input: { fontSize: FONT.body, borderBottomWidth: 1, paddingVertical: SPACE.sm },
  chips: { flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
  chip: { paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, borderWidth: 1 },
});
