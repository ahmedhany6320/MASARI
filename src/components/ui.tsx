import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { FONT, RADIUS, SPACE } from '../theme/tokens';
import { useLocalization, usePalette } from '../store/selectors';

/**
 * Shared primitives.
 *
 * Every one of these reads colour from the active palette and writing
 * direction from the active language, so no screen has to remember to handle
 * dark mode or RTL — getting either wrong in one place is exactly how an
 * Arabic app ends up half mirrored.
 */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.faint }, style]}>
      {children}
    </View>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  const { rtl } = useLocalization();
  return (
    <Text style={[styles.title, { color: p.ink, textAlign: rtl ? 'right' : 'left' }, style]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const p = usePalette();
  const { rtl } = useLocalization();
  return (
    <Text
      style={[styles.body, { color: muted ? p.sub : p.ink, textAlign: rtl ? 'right' : 'left' }, style]}
    >
      {children}
    </Text>
  );
}

export function Caption({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  const { rtl } = useLocalization();
  return (
    <Text style={[styles.caption, { color: p.sub, textAlign: rtl ? 'right' : 'left' }, style]}>
      {children}
    </Text>
  );
}

/**
 * A label/value row. Uses `row-reverse` in Arabic so the label stays on the
 * reading edge and the number on the far edge, mirroring the Latin layout
 * rather than merely right-aligning it.
 */
export function Row({
  label,
  value,
  valueColor,
  onPress,
}: {
  label: string;
  value: string;
  valueColor?: string;
  onPress?: () => void;
}) {
  const p = usePalette();
  const { rtl } = useLocalization();
  const content = (
    <View style={[styles.row, { flexDirection: rtl ? 'row-reverse' : 'row', borderColor: p.faint }]}>
      <Text style={[styles.body, { color: p.sub, flexShrink: 1 }]}>{label}</Text>
      <Text style={[styles.body, { color: valueColor ?? p.ink, fontWeight: '600' }]}>{value}</Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
      {content}
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const p = usePalette();
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? p.accent : 'transparent',
          borderColor: primary ? p.accent : p.faint,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: primary ? p.onAccent : p.ink }]}>{label}</Text>
    </Pressable>
  );
}

/** A horizontal progress meter, used for budgets and goal progress. */
export function Meter({ ratio, color }: { ratio: number; color?: string }) {
  const p = usePalette();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return (
    <View
      style={[styles.meterTrack, { backgroundColor: p.faint }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View
        style={[styles.meterFill, { width: `${clamped * 100}%`, backgroundColor: color ?? p.accent }]}
      />
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <View style={[styles.screen, { backgroundColor: p.bg }]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACE.lg,
    marginBottom: SPACE.md,
  },
  title: { fontSize: FONT.title, fontWeight: '700' },
  body: { fontSize: FONT.body },
  caption: { fontSize: FONT.small, lineHeight: FONT.small * 1.5 },
  row: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACE.md,
    gap: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: {
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: FONT.body, fontWeight: '600' },
  meterTrack: { height: 8, borderRadius: RADIUS.pill, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: RADIUS.pill },
});
