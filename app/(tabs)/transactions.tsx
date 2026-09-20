import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuickAdd } from '../../src/components/QuickAdd';
import { Body, Button, Caption, Screen, Title } from '../../src/components/ui';
import type { Tx } from '../../src/domain';
import { formatShortDate } from '../../src/i18n';
import { useLocalization, usePalette } from '../../src/store/selectors';
import { useLedger } from '../../src/store/useLedger';
import { FONT, SPACE } from '../../src/theme/tokens';

/** Transaction types that represent money leaving, for colouring the amount. */
const OUTFLOW = new Set(['expense', 'ccpay', 'debtpay', 'remit', 'lend']);

/**
 * Transactions — the ledger itself, grouped by day.
 *
 * Grouping by day rather than showing one flat list is what makes a finance
 * history readable: "what did I spend on Tuesday" is the question people
 * actually ask.
 */
export default function TransactionsScreen() {
  const p = usePalette();
  const { t, lang, money, rtl } = useLocalization();
  const insets = useSafeAreaInsets();
  const tx = useLedger((s) => s.ledger.tx);
  const cats = useLedger((s) => s.ledger.cats);
  const removeTx = useLedger((s) => s.removeTx);
  const [adding, setAdding] = useState(false);

  const catName = useMemo(() => {
    const byId = new Map(cats.map((c) => [c.id, c[lang]]));
    return (id?: string | null) => (id ? (byId.get(id) ?? '—') : '—');
  }, [cats, lang]);

  const sections = useMemo(() => {
    const buckets = new Map<string, Tx[]>();
    // `tx` is already newest-first from the store, so insertion order gives
    // newest-first days and newest-first rows within each day for free.
    for (const x of tx) {
      const d = new Date(x.ts);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const list = buckets.get(key);
      if (list) list.push(x);
      else buckets.set(key, [x]);
    }
    return Array.from(buckets.entries()).map(([key, data]) => ({
      key,
      title: formatShortDate(new Date(data[0]!.ts), lang),
      total: data
        .filter((x) => OUTFLOW.has(x.type))
        .reduce((a, x) => a + x.amt, 0),
      data,
    }));
  }, [tx, lang]);

  return (
    <Screen>
      <View style={{ paddingTop: insets.top + SPACE.lg, paddingHorizontal: SPACE.lg }}>
        <Title>{t('navTx')}</Title>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: SPACE.lg, paddingBottom: SPACE.xxl }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Body muted>{t('txEmptyT')}</Body>
            <Caption style={{ marginTop: SPACE.sm }}>{t('txEmptyS')}</Caption>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View
            style={[
              styles.sectionHeader,
              { flexDirection: rtl ? 'row-reverse' : 'row', backgroundColor: p.bg },
            ]}
          >
            <Caption>{section.title}</Caption>
            <Caption>{money(section.total)}</Caption>
          </View>
        )}
        renderItem={({ item }) => {
          const out = OUTFLOW.has(item.type);
          const memo = (lang === 'ar' ? item.m : item.mEn) || item.m || item.mEn;
          return (
            <Pressable
              onLongPress={() => removeTx(item.id)}
              accessibilityRole="button"
              accessibilityHint={t('del')}
              style={[
                styles.row,
                { flexDirection: rtl ? 'row-reverse' : 'row', borderColor: p.faint },
              ]}
            >
              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: p.ink, fontSize: FONT.body }}>
                  {memo || catName(item.cat)}
                </Text>
                <Text style={{ color: p.sub, fontSize: FONT.small }}>
                  {catName(item.cat)}
                  {item.post === false ? ` · ${t('openTag')}` : ''}
                </Text>
              </View>
              <Text style={{ color: out ? p.negative : p.positive, fontWeight: '600' }}>
                {out ? '−' : '+'} {money(item.amt)}
              </Text>
            </Pressable>
          );
        }}
      />

      <View style={{ padding: SPACE.lg }}>
        <Button label={t('addExpense')} onPress={() => setAdding(true)} />
      </View>

      <QuickAdd visible={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    justifyContent: 'space-between',
    paddingVertical: SPACE.sm,
    marginTop: SPACE.md,
  },
  row: {
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { paddingVertical: SPACE.xxl, alignItems: 'center' },
});
