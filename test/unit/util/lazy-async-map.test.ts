import { expect } from 'chai'
import { LazyAsyncMap } from '../../../lib/util/lazy-async-map'

describe('LazyAsyncMap', () => {
  it('builds a key once and shares the in-flight promise', async () => {
    let builds = 0
    const map = new LazyAsyncMap<string, string>(async (key) => {
      builds++
      await new Promise((resolve) => setTimeout(resolve, 1))
      return key
    })

    const [first, second] = await Promise.all([map.get('mainnet'), map.get('mainnet')])

    expect(first).to.equal('mainnet')
    expect(second).to.equal('mainnet')
    expect(await map.get('mainnet')).to.equal('mainnet')
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
