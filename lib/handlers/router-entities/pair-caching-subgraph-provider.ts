import { Token } from '@uniswap/sdk-core'
import { ChainId, IV3SubgraphProvider, log, V3SubgraphPool } from 'v-swap-smart-order-router'
import { StaleWhileRevalidateCache } from '../../util/stale-while-revalidate'

// The static fallback rebuilds its pool list with an on-chain multicall on every
// call, and getV3CandidatePools calls it once per request. Reusing the list for a
// token pair keeps that scan out of the request hot path.
const POOLS_TTL_MS = 60 * 1000
const POOLS_MAX_STALE_MS = 5 * 60 * 1000
// Bounds what a long-lived warm container can hold: one entry per token pair.
const POOLS_MAX_ENTRIES = 256

type GetPoolsConfig = Parameters<IV3SubgraphProvider['getPools']>[2]

/**
 * Caches a subgraph provider's result per token pair.
 *
 * The static provider ignores the block number, and its pools only rank
 * candidates, so a short TTL cannot produce a stale quote. A caller that does
 * pin a block number bypasses the cache rather than read a list built at a
 * different height.
 */
export class PairCachingV3SubgraphProvider implements IV3SubgraphProvider {
  private readonly cache = new StaleWhileRevalidateCache({
    ttlMs: POOLS_TTL_MS,
    maxStaleMs: POOLS_MAX_STALE_MS,
    maxEntries: POOLS_MAX_ENTRIES,
    onRefreshError: (key, err) =>
      log.error({ err, key }, 'Failed to refresh static subgraph pools; serving stale pools'),
  })

  constructor(private chainId: ChainId, private provider: IV3SubgraphProvider) {}

  public getPools(tokenIn?: Token, tokenOut?: Token, providerConfig?: GetPoolsConfig): Promise<V3SubgraphPool[]> {
    if (providerConfig?.blockNumber !== undefined) {
      return this.provider.getPools(tokenIn, tokenOut, providerConfig)
    }

    const key = `${this.chainId}:${tokenIn?.address.toLowerCase() ?? ''}:${tokenOut?.address.toLowerCase() ?? ''}`

    return this.cache.get(key, () => this.provider.getPools(tokenIn, tokenOut, providerConfig))
  }
}
