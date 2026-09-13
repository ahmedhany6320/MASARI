import { describe, expect, it } from 'vitest';
import { adaptTarget, livingBand } from './adaptiveDaily';
import type { Goal } from './types';

const FX = 13.6;

describe('livingBand', () => {
  it('keeps the two figures in order', () => {
    expect(livingBand(20, 40)).toEqual({ min: 20, comfort: 40 });
  });

  it('tolerates them being entered the wrong way round', () => {
    // A comfort level below the floor is a slip, not an instruction to live
    // on less than the minimum.
    expect(livingBand(40, 20)).toEqual({ min: 20, comfort: 40 });
  });

  it('treats missing figures as zero', () => {
    expect(livingBand(null, null)).toEqual({ min: 0, comfort: 0 });
    expect(livingBand(-5, 30)).toEqual({ min: 0, comfort: 30 });
  });
});

describe('adaptTarget — the goal moves both ways', () => {
  const egypt: Goal = {
    id: 'egypt', ar: 'مصر', en: 'Egypt', currency: 'EGP',
    target: 1_100_000, alloc: 0, months: 8, extEgp: 0, auto: true,
  };

  it('reports what this pace actually lands on', () => {
    const a = adaptTarget(egypt, 7745, 8, 0, FX);
    expect(a.achievable).toBeCloseTo(7745 * 8 * FX, 4);
    expect(a.reachesOriginal).toBe(false);
    expect(a.shortfall).toBeGreaterThan(0);
  });

  it('never rewrites the aspiration', () => {
    expect(adaptTarget(egypt, 100, 8, 0, FX).original).toBe(1_100_000);
  });

  it('caps the adapted figure at the aspiration', () => {
    // Overshooting is money left over, not a bigger goal.
    const a = adaptTarget(egypt, 99_999, 8, 0, FX);
    expect(a.adapted).toBe(1_100_000);
    expect(a.reachesOriginal).toBe(true);
    expect(a.progress).toBe(1);
  });

  it('rises when the pace improves', () => {
    const before = adaptTarget(egypt, 5000, 8, 0, FX);
    const after = adaptTarget(egypt, 7000, 8, 0, FX, before.adapted);
    expect(after.adapted).toBeGreaterThan(before.adapted);
    expect(after.drift).toBe('raised');
  });

  it('falls when it worsens', () => {
    const before = adaptTarget(egypt, 7000, 8, 0, FX);
    const after = adaptTarget(egypt, 5000, 8, 0, FX, before.adapted);
    expect(after.drift).toBe('lowered');
  });

  it('reports the aspiration coming back within reach', () => {
    // A windfall: the original was out of reach and now is not.
    const lean = adaptTarget(egypt, 5000, 8, 0, FX);
    const windfall = adaptTarget(egypt, 5000, 8, 60_000, FX, lean.adapted);
    expect(windfall.reachesOriginal).toBe(true);
    expect(windfall.drift).toBe('restored');
  });

  it('counts money already held toward it', () => {
    const bare = adaptTarget(egypt, 5000, 8, 0, FX);
    const withHeld = adaptTarget(egypt, 5000, 8, 20_000, FX);
    expect(withHeld.achievable).toBeGreaterThan(bare.achievable);
  });

  it('handles an AED goal without applying a rate', () => {
    const aed: Goal = { ...egypt, currency: 'AED', target: 80_000 };
    expect(adaptTarget(aed, 5000, 8, 0, FX).achievable).toBe(40_000);
  });

  it('survives a goal with no target at all', () => {
    const none: Goal = { ...egypt, target: null };
    const a = adaptTarget(none, 5000, 8, 0, FX);
    expect(a.original).toBe(0);
    expect(a.progress).toBe(1);
    expect(Number.isFinite(a.achievable)).toBe(true);
  });
});
