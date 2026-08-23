import { describe, expect, it } from 'vitest';
import { allocationCheck } from './allocation';
import type { Goal } from './types';

let seq = 0;
function goal(alloc: number, over: Partial<Goal> = {}): Goal {
  return {
    id: `g${seq++}`, ar: 'هدف', en: 'Goal',
    target: 10000, alloc, months: null, auto: false, ...over,
  };
}

describe('allocationCheck — an allocation has to be backed by real money', () => {
  it('reports what the balance covers and what it does not', () => {
    const a = allocationCheck([goal(6000), goal(4000)], 7000);
    expect(a.allocated).toBe(10000);
    expect(a.backed).toBe(7000);
    expect(a.unbacked).toBe(3000);
    expect(a.overAllocated).toBe(true);
    expect(a.free).toBe(0);
  });

  it('reports the balance left over when goals do not claim it all', () => {
    const a = allocationCheck([goal(2000)], 9000);
    expect(a.free).toBe(7000);
    expect(a.unbacked).toBe(0);
    expect(a.overAllocated).toBe(false);
    expect(a.ratio).toBeCloseTo(2 / 9, 10);
  });

  it('concentrates the shortfall instead of spreading it thin', () => {
    // 7,000 against 6,000 + 4,000: the first goal is genuinely funded and the
    // second is 3,000 short — more useful than calling both 70% funded.
    const a = allocationCheck([goal(6000), goal(4000)], 7000);
    expect(a.perGoal.map((x) => x.backed)).toEqual([6000, 1000]);
    expect(a.perGoal.map((x) => x.unbacked)).toEqual([0, 3000]);
  });

  it('never rewrites what the user declared', () => {
    const a = allocationCheck([goal(50000)], 3000);
    expect(a.perGoal.map((x) => x.alloc)).toEqual([50000]);
    expect(a.allocated).toBe(50000);
  });

  it('treats an overdrawn balance as nothing, not as negative capital', () => {
    const a = allocationCheck([goal(1000)], -500);
    expect(a.liquid).toBe(0);
    expect(a.backed).toBe(0);
    expect(a.unbacked).toBe(1000);
  });

  it('ignores a negative allocation rather than crediting it', () => {
    const a = allocationCheck([goal(-200), goal(1000)], 5000);
    expect(a.allocated).toBe(1000);
  });

  it('is quiet when there are no goals', () => {
    const a = allocationCheck([], 5000);
    expect(a.allocated).toBe(0);
    expect(a.free).toBe(5000);
    expect(a.overAllocated).toBe(false);
    expect(a.ratio).toBe(0);
  });

  it('flags allocations held against no money at all', () => {
    const a = allocationCheck([goal(1000)], 0);
    expect(a.ratio).toBe(1);
    expect(a.overAllocated).toBe(true);
  });
});
