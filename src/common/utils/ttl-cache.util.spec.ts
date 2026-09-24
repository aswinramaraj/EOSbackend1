import { KeyedTtlCache, TtlCache } from './ttl-cache.util';

describe('TtlCache', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('computes once and returns the cached value while still fresh', async () => {
    const cache = new TtlCache<number>(1000);
    const compute = jest.fn().mockResolvedValue(42);

    expect(await cache.get(compute)).toBe(42);
    expect(await cache.get(compute)).toBe(42);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes once the TTL has elapsed', async () => {
    const cache = new TtlCache<number>(1000);
    const compute = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.get(compute)).toBe(1);
    jest.advanceTimersByTime(1001);
    expect(await cache.get(compute)).toBe(2);

    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe('KeyedTtlCache', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("never leaks one key's cached value into another key's lookup", async () => {
    // The exact property HodService relies on: department A's cached CGPA
    // must never be returned for department B's request, even though both
    // share the same cache instance.
    const cache = new KeyedTtlCache<string>(1000);
    const computeForDeptA = jest.fn().mockResolvedValue('dept-A-cgpa');
    const computeForDeptB = jest.fn().mockResolvedValue('dept-B-cgpa');

    expect(await cache.get('dept:75', computeForDeptA)).toBe('dept-A-cgpa');
    expect(await cache.get('dept:76', computeForDeptB)).toBe('dept-B-cgpa');
    // Re-fetching dept 75 again must not call dept B's compute fn or return its value.
    expect(await cache.get('dept:75', computeForDeptA)).toBe('dept-A-cgpa');

    expect(computeForDeptA).toHaveBeenCalledTimes(1);
    expect(computeForDeptB).toHaveBeenCalledTimes(1);
  });

  it('recomputes only the expired key, leaving other keys cached', async () => {
    const cache = new KeyedTtlCache<number>(1000);
    const computeA = jest.fn().mockResolvedValue(1);
    const computeB = jest
      .fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(20);

    await cache.get('a', computeA);
    await cache.get('b', computeB);

    jest.advanceTimersByTime(1001);

    expect(await cache.get('b', computeB)).toBe(20);
    expect(await cache.get('a', computeA)).toBe(1);

    expect(computeA).toHaveBeenCalledTimes(2);
    expect(computeB).toHaveBeenCalledTimes(2);
  });
});
