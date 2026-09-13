import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalization, usePalette } from '../store/selectors';
import { FONT, RADIUS, SPACE } from '../theme/tokens';

/**
 * Large navigation tiles.
 *
 * Replaces thin list rows because this app is used one-handed, often standing
 * up — a 44pt row is the accessibility floor, not a target to design to. Each
 * tile carries its own live figure so the hub answers most questions without
 * being opened at all.
 */

export interface TileProps {
  icon: string;
  label: string;
  /** The live figure this tile is about. */
  value?: string;
  /** Colour for the value — usually a palette semantic. */
  valueColor?: string;
  hint?: string;
  onPress: () => void;
  /** Draws attention when something needs doing. */
  badge?: boolean;
}

export function Tile({ icon, label, value, valueColor, hint, onPress, badge }: TileProps) {
  const p = usePalette();
  const { rtl } = useLocalization();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: p.surface,
          borderColor: badge ? p.accent : p.faint,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={[styles.tileTop, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Text style={{ fontSize: 22 }}>{icon}</Text>
        {badge && <View style={[styles.dot, { backgroundColor: p.accent }]} />}
      </View>
      <Text
        style={[styles.tileLabel, { color: p.ink, textAlign: rtl ? 'right' : 'left' }]}
        numberOfLines={2}
      >
        {label}
      </Text>
      {value ? (
        <Text
          style={[styles.tileValue, { color: valueColor ?? p.sub, textAlign: rtl ? 'right' : 'left' }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {hint ? (
        <Text style={[styles.tileHint, { color: p.sub, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Two-column grid of tiles. */
export function TileGrid({ children }: { children: React.ReactNode }) {
  const { rtl } = useLocalization();
  return (
    <View style={[styles.grid, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>{children}</View>
  );
}

/**
 * Full-width action strip, for the one or two things done most often.
 * Sized generously because these are hit while walking.
 */
export function QuickAction({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const p = usePalette();
  const { rtl } = useLocalization();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: primary ? p.accent : p.surface,
          borderColor: primary ? p.accent : p.faint,
          flexDirection: rtl ? 'row-reverse' : 'row',
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={{ fontSize: 20 }}>{icon}</Text>
      <Text style={[styles.actionLabel, { color: primary ? p.onAccent : p.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexWrap: 'wrap', gap: SPACE.md },
  tile: {
    // Two per row, accounting for the gap between them.
    width: '47.5%',
    minHeight: 116,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACE.md,
    justifyContent: 'flex-start',
  },
  tileTop: { justifyContent: 'space-between', alignItems: 'flex-start' },
  tileLabel: { fontSize: FONT.body, fontWeight: '600', marginTop: SPACE.sm },
  tileValue: { fontSize: FONT.title, fontWeight: '700', marginTop: SPACE.xs },
  tileHint: { fontSize: FONT.micro, marginTop: SPACE.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.lg,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    minHeight: 56,
  },
  actionLabel: { fontSize: FONT.body, fontWeight: '700' },
});
