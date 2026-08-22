import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalization, usePalette } from '../store/selectors';

/**
 * Floating action button for recording a spend.
 *
 * Recording an expense is the single most frequent thing anyone does here, and
 * it happens standing at a till one-handed. A circular target pinned above the
 * tab bar is reachable with the thumb from anywhere in the app, needs no label
 * to be understood, and never scrolls away — which a button inside the page
 * always eventually does.
 *
 * Sits on the reading edge: left in Arabic, right in English, so it falls under
 * the thumb rather than across the screen.
 */
export function Fab({ onPress }: { onPress: () => void }) {
  const p = usePalette();
  const { t, rtl } = useLocalization();
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('addExpense')}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: p.accent,
          // Cleared above the tab bar (62 + inset) plus breathing room.
          bottom: insets.bottom + 62 + 16,
          ...(rtl ? { left: 20 } : { right: 20 }),
          transform: [{ scale: pressed ? 0.94 : 1 }],
          shadowColor: '#000',
        },
      ]}
    >
      <Text style={[styles.plus, { color: p.onAccent }]}>＋</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  plus: { fontSize: 34, lineHeight: 38, fontWeight: '400' },
});
