import { Tabs } from 'expo-router';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalization, usePalette } from '../../src/store/selectors';
import { FONT, SPACE } from '../../src/theme/tokens';

/** Keeps Home the landing tab even though Arabic declares it last. */
export const unstable_settings = { initialRouteName: 'index' };

/**
 * Bottom tab bar.
 *
 * Two things here are easy to get wrong and were, at first:
 *
 * 1. ORDER. `tabBarStyle` lands on the bar's outer container, but the buttons
 *    live in an inner row inside it — so `flexDirection: 'row-reverse'` there
 *    does nothing. The order comes from the order the screens are DECLARED,
 *    which is why the list below is reversed for Arabic instead. Home then
 *    sits on the right, where the reading eye starts.
 *
 * 2. HEIGHT. The navigator applies `paddingBottom: insets.bottom` and its own
 *    height BEFORE spreading `tabBarStyle`, so setting either without adding
 *    the inset back overrides the safe-area padding — and with edge-to-edge on
 *    Android the bar slides under the system gesture bar and stops responding
 *    to taps. Any height set here must include `insets.bottom`.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return (
    <View style={styles.icon}>
      <Text style={{ color, fontSize: 24 }}>{glyph}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const p = usePalette();
  const { t, rtl } = useLocalization();
  const insets = useSafeAreaInsets();

  const screens = [
    { name: 'index', title: t('navHome'), glyph: '⌂' },
    { name: 'plan', title: t('navPlan'), glyph: '◈' },
    { name: 'transactions', title: t('navTx'), glyph: '≡' },
    { name: 'calendar', title: t('navCal'), glyph: '▦' },
    { name: 'more', title: t('navMore'), glyph: '⋯' },
  ];

  const ordered = rtl ? [...screens].reverse() : screens;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.sub,
        tabBarStyle: {
          backgroundColor: p.surface,
          borderTopColor: p.faint,
          // The inset MUST be added back — see the note above.
          height: 62 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: SPACE.xs,
        },
        tabBarLabelStyle: {
          fontSize: FONT.small,
          fontWeight: '600',
        },
      }}
    >
      {ordered.map((s) => (
        <Tabs.Screen
          key={s.name}
          name={s.name}
          options={{
            title: s.title,
            tabBarIcon: ({ color }) => <TabIcon glyph={s.glyph} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', justifyContent: 'center' },
});
