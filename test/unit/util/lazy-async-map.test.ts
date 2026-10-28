import { expect } from 'chai'
import { LazyAsyncMap } from '../../../lib/util/lazy-async-map'

describe('LazyAsyncMap', () => {
  it('builds a key once and shares the in-flight promise', async () => {
    let builds = 0
    let resolve: (value: string) => void = () => undefined
    const map = new LazyAsyncMap<string, string>(() => {
      builds++
      return new Promise((res) => {
        resolve = res
      })
    })

    const first = map.get('mainnet')
    const second = map.get('mainnet')

    await Promise.resolve()
    expect(builds).to.equal(1)
    resolve('dependencies')

    expect(await first).to.equal('dependencies')
    expect(await second).to.equal('dependencies')
    expect(await map.get('mainnet')).to.equal('dependencies')
    expect(builds).to.equal(1)
  })

  it('evicts a rejected build so a later call can retry', async () => {
    let builds = 0
    const map = new LazyAsyncMap<string, string>(async () => {
      builds++
      if (builds === 1) {
        throw new Error('temporary failure')
      }
      return 'ok'
    })

    let error: Error | undefined
    try {
      await map.get('mainnet')
    } catch (err) {
      error = err as Error
    }
    expect(error?.message).to.equal('temporary failure')

    expect(await map.get('mainnet')).to.equal('ok')
    expect(builds).to.equal(2)
  })
})
