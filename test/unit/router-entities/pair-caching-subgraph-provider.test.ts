import { Token } from '@uniswap/sdk-core'
import { expect } from 'chai'
import { ChainId, IV3SubgraphProvider, V3SubgraphPool } from 'v-swap-smart-order-router'
import { PairCachingV3SubgraphProvider } from '../../../lib/handlers/router-entities/pair-caching-subgraph-provider'

const token = (address: string) => new Token(ChainId.MAINNET, address, 18)

const WETH = token('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
const USDC = token('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const DAI = token('0x6B175474E89094C44Da98b954EedeAC495271d0F')

class CountingProvider implements IV3SubgraphProvider {
  public calls: Array<[string | undefined, string | undefined]> = []

  constructor(private readonly delayMs = 0) {}

  public async getPools(tokenIn?: Token, tokenOut?: Token): Promise<V3SubgraphPool[]> {
    this.calls.push([tokenIn?.address, tokenOut?.address])
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    }
    return []
  }
}

describe('PairCachingV3SubgraphProvider', () => {
  it('reuses the pool list for a repeated token pair', async () => {
    const inner = new CountingProvider()
    const provider = new PairCachingV3SubgraphProvider(ChainId.MAINNET, inner)

    await provider.getPools(WETH, USDC)
    await provider.getPools(WETH, USDC)

    expect(inner.calls).to.have.length(1)
  })

  it('keeps a separate entry per token pair', async () => {
    const inner = new CountingProvider()
    const provider = new PairCachingV3SubgraphProvider(ChainId.MAINNET, inner)

    await provider.getPools(WETH, USDC)
    await provider.getPools(WETH, DAI)

    expect(inner.calls).to.have.length(2)
  })

  it('shares one in-flight load between concurrent callers', async () => {
    const inner = new CountingProvider(20)
    const provider = new PairCachingV3SubgraphProvider(ChainId.MAINNET, inner)

    await Promise.all([provider.getPools(WETH, USDC), provider.getPools(WETH, USDC)])

    expect(inner.calls).to.have.length(1)
  })

  it('does not share entries across chains', async () => {
    const inner = new CountingProvider()
    const mainnet = new PairCachingV3SubgraphProvider(ChainId.MAINNET, inner)
    const polygon = new PairCachingV3SubgraphProvider(ChainId.POLYGON, inner)

    await mainnet.getPools(WETH, USDC)
    await polygon.getPools(WETH, USDC)

    expect(inner.calls).to.have.length(2)
  })

  it('bypasses the cache when the caller pins a block number', async () => {
    const inner = new CountingProvider()
    const provider = new PairCachingV3SubgraphProvider(ChainId.MAINNET, inner)

    await provider.getPools(WETH, USDC, { blockNumber: 1 })
    await provider.getPools(WETH, USDC, { blockNumber: 2 })

    expect(inner.calls).to.have.length(2)
  })
})
