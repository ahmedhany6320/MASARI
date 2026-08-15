import type { OvertimeEntry } from './types';

/** Overtime earned: hours × rate × multiplier, summed. */
export function overtimeTotal(entries: OvertimeEntry[]): number {
  return entries.reduce((a, e) => a + e.h * e.rate * e.mult, 0);
}
