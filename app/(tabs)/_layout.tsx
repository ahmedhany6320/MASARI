import { Tabs } from 'expo-router';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import { useLocalization, usePalette } from '../../src/store/selectors';
import { FONT } from '../../src/theme/tokens';

/**
 * Bottom tab bar, matching the prototype's five sections.
 *
 * Glyphs are plain text rather than an icon font: it keeps the bundle free of
 * a dependency for five symbols, and they render identically in both writing
 * directions.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return (
    <View style={styles.icon}>
      <Text style={{ color, fontSize: 20 }}>{glyph}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const p = usePalette();
  const { t } = useLocalization();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.sub,
        tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.faint },
        tabBarLabelStyle: { fontSize: FONT.micro },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('navHome'),
          tabBarIcon: ({ color }) => <TabIcon glyph="●" color={color} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: t('navPlan'),
          tabBarIcon: ({ color }) => <TabIcon glyph="◆" color={color} />,
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
