import type { ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalization, usePalette } from '../store/selectors';
import { FONT, RADIUS, SPACE } from '../theme/tokens';
import { Body, Button, Caption, Title } from './ui';

/**
 * Form primitives.
 *
 * Every add/edit flow in the app is built from these, so text alignment,
 * writing direction and theming are handled once. Screens that hand-roll
 * inputs are how an RTL app ends up with three different-looking forms.
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ marginBottom: SPACE.lg }}>
      <Body>{label}</Body>
      {hint ? <Caption>{hint}</Caption> : null}
      {children}
    </View>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  numeric,
  big,
  multiline,
  secure,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  /** Renders at display size — used for the one figure a sheet is about. */
  big?: boolean;
  multiline?: boolean;
  secure?: boolean;
}) {
  const p = usePalette();
  const { rtl } = useLocalization();
  return (
    <Field label={label} hint={hint}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? (numeric ? '0' : undefined)}
        placeholderTextColor={p.sub}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        secureTextEntry={secure}
        multiline={multiline}
        autoCapitalize={numeric ? 'none' : 'sentences'}
        style={[
          styles.input,
          {
            color: p.ink,
            borderColor: p.faint,
            textAlign: rtl ? 'right' : 'left',
            fontSize: big ? FONT.large : FONT.body,
            fontWeight: big ? '700' : '400',
            minHeight: multiline ? 80 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
        accessibilityLabel={label}
      />
    </Field>
  );
}

export interface ChipOption<T> {
  id: T;
  label: string;
}

export function Chips<T extends string | number>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label?: string;
  hint?: string;
  options: ChipOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const p = usePalette();
  const { rtl } = useLocalization();
  const body = (
    <View style={[styles.chips, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={String(o.id)}
            onPress={() => onChange(o.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[
              styles.chip,
              { borderColor: on ? p.accent : p.faint, backgroundColor: on ? p.accentWash : 'transparent' },
            ]}
          >
            <Text style={{ color: on ? p.accentDeep : p.ink, fontSize: FONT.small }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  if (!label) return body;
  return (
    <Field label={label} hint={hint}>
      {body}
    </Field>
  );
}

/**
 * Day-of-month picker.
 *
 * Capped at 28 on purpose: a commitment set to the 31st would silently skip
 * February, and every real recurring bill can be expressed within 1–28.
 */
export function DayPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (d: number) => void;
}) {
  const p = usePalette();
  const { rtl } = useLocalization();
  return (
    <Field label={label}>
      <View style={[styles.days, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => {
          const on = d === value;
          return (
            <Pressable
              key={d}
              onPress={() => onChange(d)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[
                styles.day,
                { borderColor: on ? p.accent : p.faint, backgroundColor: on ? p.accentWash : 'transparent' },
              ]}
            >
              <Text style={{ color: on ? p.accentDeep : p.ink, fontSize: FONT.small }}>{d}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

/**
 * Bottom sheet used by every add/edit flow.
 *
 * The primary action is disabled rather than hidden while the form is
 * incomplete, so the shape of the sheet does not shift as fields are filled.
 */
export function Sheet({
  visible,
  title,
  onClose,
  onSubmit,
  submitLabel,
  canSubmit = true,
  destructive,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  canSubmit?: boolean;
  /** Optional delete action, rendered apart from the primary action. */
  destructive?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  const p = usePalette();
  const { t } = useLocalization();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('cancel')} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
      >
        <View style={[styles.sheet, { backgroundColor: p.surface, borderColor: p.faint }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Title>{title}</Title>
            <View style={{ marginTop: SPACE.lg }}>{children}</View>
            <View style={{ gap: SPACE.sm, marginTop: SPACE.sm }}>
              {onSubmit && (
                <Button label={submitLabel ?? t('add')} onPress={onSubmit} disabled={!canSubmit} />
              )}
              {destructive && (
                <Button label={destructive.label} variant="secondary" onPress={destructive.onPress} />
              )}
              <Button label={t('cancel')} variant="secondary" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  input: {
    borderBottomWidth: 1,
    paddingVertical: SPACE.sm,
    marginTop: SPACE.sm,
  },
  chips: { flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
  chip: {
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  days: { flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.sm },
  day: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACE.lg,
    maxHeight: '90%',
  },
});

/**
 * A discrete slider, built from a pan gesture rather than a native module.
 *
 * Deliberately dependency-free: pulling in a native slider would make this an
 * unavoidable new binary, and the whole point of the over-the-air path is that
 * a change like this reaches the phone without one. `PanResponder` and a
 * measured track are enough for an integer range.
 */
export function RangeSlider({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  formatValue,
}: {
  label?: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  const p = usePalette();
  const { rtl } = useLocalization();
  const [width, setWidth] = useState(0);

  const span = Math.max(1, max - min);
  const ratio = Math.min(1, Math.max(0, (value - min) / span));

  // Kept in a ref so the responder closure never reads a stale width.
  const widthRef = useRef(0);
  widthRef.current = width;

  const pick = useCallback(
    (x: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      // The track runs right-to-left in Arabic, so the gesture has to be read
      // in the same direction the thumb is drawn.
      const raw = rtl ? 1 - x / w : x / w;
      const next = Math.round(min + Math.min(1, Math.max(0, raw)) * span);
      onChange(Math.min(max, Math.max(min, next)));
    },
    [min, max, span, onChange, rtl],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
      }),
    [pick],
  );

  return (
    <View style={{ marginBottom: SPACE.lg }}>
      {label != null && (
        <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between' }}>
          <Body>{label}</Body>
          <Body style={{ color: p.accentDeep, fontWeight: '700' }}>
            {formatValue ? formatValue(value) : String(value)}
          </Body>
        </View>
      )}
      {hint != null && hint !== '' && <Caption>{hint}</Caption>}

      <View
        {...responder.panHandlers}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        // A generous touch target around a thin visual track: the bar is 6px
        // but the finger is not.
        style={{ paddingVertical: SPACE.md, marginTop: SPACE.sm }}
      >
        <View style={{ height: 6, borderRadius: 3, backgroundColor: p.faint }}>
          <View
            style={{
              position: 'absolute',
              [rtl ? 'right' : 'left']: 0,
              top: 0,
              bottom: 0,
              width: `${ratio * 100}%`,
              borderRadius: 3,
              backgroundColor: p.accent,
            }}
          />
          <View
            style={{
              position: 'absolute',
              [rtl ? 'right' : 'left']: `${ratio * 100}%`,
              top: -9,
              width: 24,
              height: 24,
              marginHorizontal: -12,
              borderRadius: 12,
              backgroundColor: p.accent,
              borderWidth: 3,
              borderColor: p.surface,
            }}
          />
        </View>
      </View>
    </View>
  );
}
