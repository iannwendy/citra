/**
 * Run `worker` over `items` with at most `limit` tasks in flight.
 *
 * Results keep the input order. Worker rejections are captured per item
 * (never abort the whole pool) so one failing upload does not stop the batch.
 */
export type PoolResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PoolResult<R>[]> {
  const results: PoolResult<R>[] = new Array(items.length);
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, items.length || 1));
  let next = 0;

  const runner = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };

  await Promise.all(Array.from({ length: size }, runner));
  return results;
}
