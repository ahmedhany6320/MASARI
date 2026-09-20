import type { Theme } from '../domain/types';

/**
 * Design tokens carried over from the prototype's CSS custom properties, so
 * the app keeps the look the user already designed rather than restarting
 * from a framework default.
 *
 * Semantic names only — components never hardcode a hex value, which is what
 * makes the dark theme a one-line swap instead of an audit.
 */
export interface Palette {
  /** Page background. */
  bg: string;
  /** Card and sheet background. */
  surface: string;
  /** Slightly recessed surface, for nested rows. */
  surfaceMuted: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. */
  sub: string;
  /** Hairlines and dividers. */
  faint: string;
  /** Brand accent. */
  accent: string;
  /** Accent for emphasis on the current background. */
  accentDeep: string;
  /** Tinted accent background. */
  accentWash: string;
  /** Money coming in / on track. */
  positive: string;
  /** Money going out / over budget. */
  negative: string;
  /** Approaching a limit. */
  warn: string;
  /** Text drawn on top of the accent. */
  onAccent: string;
}

export const LIGHT: Palette = {
  bg: '#f3f2f2',
  surface: '#fdfcfc',
  surfaceMuted: '#f8f4f4',
  ink: '#201e1d',
  sub: '#6f6b68',
  faint: '#dedad7',
  accent: '#ec3013',
  accentDeep: '#9e3526',
  accentWash: '#fff2ef',
  positive: '#1f7a5c',
  negative: '#c94b39',
  warn: '#b06a12',
  onAccent: '#ffffff',
};

export const DARK: Palette = {
  bg: '#171615',
  surface: '#201e1d',
  surfaceMuted: '#2d2b2b',
  ink: '#f3f2f2',
  sub: '#a8a29d',
  faint: '#3a3733',
  accent: '#f2593f',
  accentDeep: '#ff9d8b',
  accentWash: '#2d2b2b',
  positive: '#5fc39b',
  negative: '#ff9784',
  warn: '#e0a45c',
  onAccent: '#171615',
};

export function paletteFor(theme: Theme): Palette {
  return theme === 'dark' ? DARK : LIGHT;
}

/** Spacing scale, in points. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

/**
 * Type scale, in points.
 *
 * Sized up from the original port after real use: Arabic script carries more
 * detail per glyph than Latin at the same point size, and this is read at
 * arm's length, often in a shop. `micro` is the floor — nothing meaningful
 * should be smaller than this.
 */
export const FONT = {
  micro: 12,
  small: 14,
  body: 16,
  title: 20,
  large: 26,
  /** The Safe Spend Limit itself — the one number the whole app exists to show. */
  hero: 48,
} as const;
