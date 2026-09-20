import { describe, expect, it } from 'vitest';

/**
 * The suite's frame of reference.
 *
 * Cycle boundaries are local-time by design, so a fixture with absolute
 * timestamps falls on a different side of a boundary depending on where the
 * tests run. That is not hypothetical: the two goalPlan baseline tests passed
 * in UTC and failed in Gulf time, from the same correct implementation, because
 * a 13.50 purchase at 05:12 UTC sits before an 08:00 local baseline in one
 * frame and after it in the other.
 *
 * `vitest.config.mts` pins TZ to UTC so every machine agrees. This test is the
 * alarm: if that pin ever stops working, the suite says so in one line instead
 * of producing different money figures depending on who ran it.
 */
describe('the test suite runs in a fixed timezone', () => {
  it('is UTC', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  it('places a local-time construction where UTC would', () => {
    // If this drifts, every cycle-boundary expectation in the suite drifts.
    expect(new Date(2026, 7, 14, 8, 0, 0).toISOString()).toBe('2026-08-14T08:00:00.000Z');
  });

  it('puts the fixture purchase before the baseline the tests declare', () => {
    // The exact pair that diverged. Named here so the reason is findable from
    // the failure rather than from a commit message.
    const purchase = Date.parse('2026-08-14T05:12:55.906Z');
    const baseline = new Date(2026, 7, 14, 8, 0, 0).getTime();
    expect(purchase).toBeLessThan(baseline);
  });
});
