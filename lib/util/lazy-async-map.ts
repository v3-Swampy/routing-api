/**
 * Memoizes an async builder per key while sharing in-flight work.
 *
 * A rejected build is evicted so a later request can retry it instead of
 * pinning the Lambda container to a transient failure.
 */
export class LazyAsyncMap<K, V> {
  private values = new Map<K, Promise<V>>()

  constructor(private readonly build: (key: K) => Promise<V>) {}

  public get(key: K): Promise<V> {
    const existing = this.values.get(key)
    if (existing) {
      return existing
    }

    const value = Promise.resolve().then(() => this.build(key))
    this.values.set(key, value)
    value.catch(() => {
      if (this.values.get(key) === value) {
        this.values.delete(key)
      }
    })

    return value
  }
}
