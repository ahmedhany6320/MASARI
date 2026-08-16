import { Tabs } from 'expo-router';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import { useLocalization, usePalette } from '../../src/store/selectors';
import { FONT, SPACE } from '../../src/theme/tokens';

/**
 * Bottom tab bar, matching the prototype's five sections.
 *
 * In Arabic the whole bar is reversed with `row-reverse` so Home sits on the
 * RIGHT, where the reading eye starts. Native RTL mirroring is deliberately
 * switched off app-wide (see `app/_layout.tsx`), so the bar has to be flipped
 * here explicitly — otherwise the first tab lands on the left and the order
 * reads backwards to an Arabic speaker.
 *
 * Glyphs are plain text rather than an icon font: it keeps the bundle free of
 * a dependency for five symbols, and they render identically both ways round.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return (
    <View style={styles.icon}>
      <Text style={{ color, fontSize: 22 }}>{glyph}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const p = usePalette();
  const { t, rtl } = useLocalization();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.sub,
        tabBarStyle: {
          backgroundColor: p.surface,
          borderTopColor: p.faint,
          // Reverses the whole strip in Arabic.
          flexDirection: rtl ? 'row-reverse' : 'row',
          // Taller bar so the bigger labels are not cramped against the edge.
          height: 68,
          paddingTop: SPACE.sm,
          paddingBottom: SPACE.sm,
        },
        tabBarLabelStyle: {
          // Was FONT.micro (11) and genuinely hard to read; this is the
          // smallest size that stays comfortable at arm's length.
          fontSize: FONT.small,
          fontWeight: '600',
          marginTop: 2,
        },
        tabBarItemStyle: { paddingVertical: SPACE.xs },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('navHome'),
          tabBarIcon: ({ color }) => <TabIcon glyph="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: t('navPlan'),
          tabBarIcon: ({ color }) => <TabIcon glyph="◈" color={color} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: t('navTx'),
          tabBarIcon: ({ color }) => <TabIcon glyph="≡" color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: t('navCal'),
          tabBarIcon: ({ color }) => <TabIcon glyph="▦" color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('navMore'),
          tabBarIcon: ({ color }) => <TabIcon glyph="⋯" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', justifyContent: 'center' },
});
