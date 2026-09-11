/**
 * Minimal in-process TTL cache — no Redis, no new dependency. For dashboard
 * aggregates that are expensive to (re)compute (a full-table SUM/GROUP BY)
 * but don't need to be real-time-exact: a value up to `ttlMs` stale is fine
 * for a summary tile, and this directly cuts DB load when several staff
 * hit the same dashboard within the same short window. Not for anything
 * that must reflect a write made a second ago (use a real query for that).
 */
export class TtlCache<T> {
  private value: T | undefined;
  private expiresAt = 0;

  constructor(private readonly ttlMs: number) {}

  /** Returns the cached value if still fresh, otherwise calls `compute`, caches, and returns the fresh result. */
  async get(compute: () => Promise<T>): Promise<T> {
    if (this.value !== undefined && Date.now() < this.expiresAt) {
      return this.value;
    }
    const fresh = await compute();
    this.value = fresh;
    this.expiresAt = Date.now() + this.ttlMs;
    return fresh;
  }
}
