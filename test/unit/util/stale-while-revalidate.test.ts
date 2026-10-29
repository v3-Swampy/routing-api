import { expect } from 'chai'
import { StaleWhileRevalidateCache } from '../../../lib/util/stale-while-revalidate'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('StaleWhileRevalidateCache', () => {
  it('loads a key once while the entry is fresh', async () => {
    let loads = 0
    const cache = new StaleWhileRevalidateCache({
      ttlMs: 1_000,
      maxStaleMs: 1_000,
      onRefreshError: () => {},
    })
    const load = async () => {
      loads++
      return 'v1'
    }

    expect(await cache.get('key', load)).to.equal('v1')
    expect(await cache.get('key', load)).to.equal('v1')
    expect(loads).to.equal(1)
  })

  it('serves stale while one background refresh runs', async () => {
    let loads = 0
    let resolveRefresh!: (value: string) => void
    const cache = new StaleWhileRevalidateCache({
      ttlMs: 20,
      maxStaleMs: 1_000,
      onRefreshError: () => {},
    })

    expect(
      await cache.get('key', async () => {
        loads++
        return 'v1'
      })
    ).to.equal('v1')

    await delay(30)

    const refresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    const load = async () => {
      loads++
      return refresh
    }

    expect(await cache.get('key', load)).to.equal('v1')
    expect(await cache.get('key', load)).to.equal('v1')
    expect(loads).to.equal(2)

    resolveRefresh('v2')
    await delay(0)

    expect(await cache.get('key', load)).to.equal('v2')
    expect(loads).to.equal(2)
  })

  it('stops serving stale after max stale age and reports refresh errors', async () => {
    let loads = 0
    const errors: string[] = []
    const cache = new StaleWhileRevalidateCache({
      ttlMs: 10,
      maxStaleMs: 30,
      onRefreshError: (_key, err) => errors.push((err as Error).message),
    })

    expect(
      await cache.get('key', async () => {
        loads++
        return 'v1'
      })
    ).to.equal('v1')

    await delay(20)

    expect(
      await cache.get('key', () => {
        loads++
        throw new Error('s3 down')
      })
    ).to.equal('v1')
    await delay(10)
    expect(errors).to.deep.equal(['s3 down'])

    await delay(30)

    let error: Error | undefined
    try {
      await cache.get('key', () => {
        loads++
        throw new Error('s3 down')
      })
    } catch (err) {
      error = err as Error
    }

    expect(error?.message).to.equal('s3 down')
    expect(loads).to.equal(3)
  })

  it('drops the oldest entry once the map is full', async () => {
    let loads = 0
    const cache = new StaleWhileRevalidateCache({
      ttlMs: 1_000,
      maxStaleMs: 1_000,
      maxEntries: 2,
      onRefreshError: () => {},
    })
    const load = async () => {
      loads++
      return 'v1'
    }

    await cache.get('a', load)
    await cache.get('b', load)
    await cache.get('c', load)
    await cache.get('a', load)

    expect(loads).to.equal(4)
  })
})
