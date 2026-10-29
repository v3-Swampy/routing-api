type CacheEntry = {
  value: unknown
  freshUntil: number
  staleUntil: number
}

export type StaleWhileRevalidateOptions = {
  ttlMs: number
  maxStaleMs: number
  onRefreshError: (key: string, err: unknown) => void
  /** Drops the oldest entries once the map holds more than this many. */
  maxEntries?: number
}

/**
 * Request-triggered stale-while-revalidate cache.
 *
 * Fresh entries are returned directly. Expired entries are returned immediately
 * while one background refresh runs. After `maxStaleMs`, the next caller waits
 * for a refresh so a persistent S3 outage cannot serve stale data forever.
 */
export class StaleWhileRevalidateCache {
  private entries = new Map<string, CacheEntry>()
  private refreshes = new Map<string, Promise<unknown>>()

  constructor(private readonly options: StaleWhileRevalidateOptions) {}

  public async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key)
    const now = Date.now()

    if (entry) {
      if (now < entry.freshUntil) {
        return entry.value as T
      }

      if (now < entry.staleUntil) {
        this.refresh(key, load).catch((err) => this.options.onRefreshError(key, err))
        return entry.value as T
      }
    }

    return this.refresh(key, load)
  }

  private refresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.refreshes.get(key)
    if (pending) {
      return pending as Promise<T>
    }

    const request = Promise.resolve()
      .then(load)
      .then((value) => {
        const now = Date.now()
        this.entries.set(key, {
          value,
          freshUntil: now + this.options.ttlMs,
          staleUntil: now + this.options.ttlMs + this.options.maxStaleMs,
        })
        this.evictOldest()
        return value
      })

    this.refreshes.set(key, request)
    const clear = () => {
      if (this.refreshes.get(key) === request) {
        this.refreshes.delete(key)
      }
    }
    request.then(clear, clear)

    return request
  }

  private evictOldest(): void {
    const maxEntries = this.options.maxEntries
    if (!maxEntries) {
      return
    }

    while (this.entries.size > maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) {
        return
      }
      this.entries.delete(oldest.value)
    }
  }
}
