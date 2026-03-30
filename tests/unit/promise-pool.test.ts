import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '@electron/utils/promise-pool';

describe('mapWithConcurrency', () => {
  it('preserves order while capping concurrent work', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('rejects invalid concurrency values', async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(
      'Concurrency must be a positive integer',
    );
  });
});
