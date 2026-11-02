import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from './concurrencyPool';

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('runWithConcurrency', () => {
  it('never runs more than `limit` workers at once and keeps result order', async () => {
    let active = 0;
    let peak = 0;
    const results = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5 * (8 - n)));
      active--;
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('actually starts work in parallel (3 in flight before any completes)', async () => {
    const gates = [defer(), defer(), defer(), defer()];
    const started: number[] = [];
    const run = runWithConcurrency([0, 1, 2, 3], 3, async (i) => {
      started.push(i);
      await gates[i].promise;
      return i;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates[1].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([0, 1, 2, 3]);
    gates.forEach((g) => g.resolve());
    await run;
  });

  it('captures failures per item without aborting the pool', async () => {
    const results = await runWithConcurrency(['a', 'b', 'c'], 2, async (x) => {
      if (x === 'b') throw new Error('boom');
      return x.toUpperCase();
    });
    expect(results[0]).toEqual({ ok: true, value: 'A' });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 'C' });
  });

  it('handles empty input and non-positive limits', async () => {
    expect(await runWithConcurrency([], 3, async () => 1)).toEqual([]);
    const r = await runWithConcurrency([1, 2], 0, async (n) => n);
    expect(r).toHaveLength(2);
  });
});
