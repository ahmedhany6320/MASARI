import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Caption, Card, Row, Screen, Title } from '../../src/components/ui';
import { MONTHS } from '../../src/i18n';
import { useLocalization, usePalette } from '../../src/store/selectors';
import { useLedger } from '../../src/store/useLedger';
import { FONT, RADIUS, SPACE } from '../../src/theme/tokens';

/**
 * Calendar — spending and obligations laid out across the month.
 *
 * A month grid rather than a list, because the question it answers is "when in
 * the month does my money go", which is inherently spatial. Days carry a dot
 * when something is due and a tint proportional to what was spent.
 */
export default function CalendarScreen() {
  const p = usePalette();
  const { t, lang, money, rtl } = useLocalization();
  const insets = useSafeAreaInsets();
  const ledger = useLedger((s) => s.ledger);

  const today = new Date();
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState<number>(today.getDate());

  const view = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  // Spend per day-of-month for the month being viewed.
  const spendByDay = useMemo(() => {
    const acc = new Map<number, number>();
    for (const x of ledger.tx) {
      if (x.type !== 'expense') continue;
      const d = new Date(x.ts);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      acc.set(d.getDate(), (acc.get(d.getDate()) ?? 0) + x.amt);
    }
    return acc;
  }, [ledger.tx, year, month]);

  // Commitments and planned transfers land on a day-of-month.
  const dueByDay = useMemo(() => {
    const acc = new Map<number, { name: string; amt: number }[]>();
    const push = (day: number | null, name: string, amt: number) => {
      if (!day) return;
      const list = acc.get(day) ?? [];
      list.push({ name, amt });
      acc.set(day, list);
    };
    for (const k of ledger.commits) {
      if (k.paused || k.paidMonth) continue;
      push(k.day, k[lang], k.amt ?? 0);
    }
    for (const tf of ledger.planTf) push(tf.day, t('plannedTransfers'), tf.amt);
    return acc;
  }, [ledger.commits, ledger.planTf, lang, t]);

  const maxSpend = Math.max(1, ...Array.from(spendByDay.values()));
  const isCurrentMonth = monthOffset === 0;

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const selectedSpend = spendByDay.get(selected) ?? 0;
  const selectedDue = dueByDay.get(selected) ?? [];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: SPACE.lg,
          paddingTop: insets.top + SPACE.lg,
          paddingBottom: SPACE.xxl,
        }}
      >
        <Title>{t('navCal')}</Title>

        <View style={[styles.monthNav, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          <Pressable onPress={() => setMonthOffset((m) => m - 1)} accessibilityRole="button">
            <Text style={{ color: p.accent, fontSize: FONT.title }}>{rtl ? '›' : '‹'}</Text>
          </Pressable>
          <Body>{`${MONTHS[lang][month]} ${year}`}</Body>
          <Pressable onPress={() => setMonthOffset((m) => m + 1)} accessibilityRole="button">
            <Text style={{ color: p.accent, fontSize: FONT.title }}>{rtl ? '‹' : '›'}</Text>
          </Pressable>
        </View>

        <Card>
          <View style={[styles.grid, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
            {cells.map((day, i) => {
              if (day == null) return <View key={`pad${i}`} style={styles.cell} />;
              const spent = spendByDay.get(day) ?? 0;
              const due = dueByDay.has(day);
              const isToday = isCurrentMonth && day === today.getDate();
              const on = day === selected;
              return (
                <Pressable
                  key={day}
                  onPress={() => setSelected(day)}
                  accessibilityRole="button"
                  accessibilityLabel={`${day} · ${money(spent)}`}
                  style={[
                    styles.cell,
                    {
                      backgroundColor: on
                        ? p.accentWash
                        : spent > 0
                          ? // Tint scales with the day's spend relative to the
                            // month's worst day, so heavy days stand out.
                            withAlpha(p.accent, 0.08 + 0.35 * (spent / maxSpend))
                          : 'transparent',
                      borderColor: isToday ? p.accent : 'transparent',
                    },
                  ]}
                >
                  <Text style={{ color: p.ink, fontSize: FONT.small }}>{day}</Text>
                  {due && <View style={[styles.dot, { backgroundColor: p.accentDeep }]} />}
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card>
          <Title>{`${selected} ${MONTHS[lang][month]}`}</Title>
          <Row label={t('todaySpend')} value={money(selectedSpend)} />
          {selectedDue.length === 0 ? (
            <Caption style={{ marginTop: SPACE.sm }}>{t('upcomingEmpty')}</Caption>
          ) : (
            selectedDue.map((d, i) => <Row key={i} label={d.name} value={money(d.amt)} />)
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

/**
 * Applies alpha to a `#rrggbb` token. Kept local because it exists only to
 * tint calendar cells; the palette itself stays fully opaque.
 */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

const styles = StyleSheet.create({
  monthNav: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACE.lg,
  },
  grid: { flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
});
