import { Protocol } from '@uniswap/router-sdk'
import {
  ChainId,
  IV2SubgraphProvider,
  IV3SubgraphProvider,
  log,
  V2SubgraphPool,
  V3SubgraphPool,
} from 'v-swap-smart-order-router'
import { S3_POOL_CACHE_KEY } from '../../util/pool-cache-key'
import { s3Client } from '../../util/s3'
import { StaleWhileRevalidateCache } from '../../util/stale-while-revalidate'

const POOL_CACHE_TTL_MS = 4 * 60 * 1000
// The pool cache cron runs every 15 minutes. Serving a stale list for at most
// one cron interval keeps a transient S3 outage from failing quotes while still
// bounding how long deprecated pools can be routed against.
const POOL_CACHE_MAX_STALE_MS = 15 * 60 * 1000

const POOL_CACHE = new StaleWhileRevalidateCache({
  ttlMs: POOL_CACHE_TTL_MS,
  maxStaleMs: POOL_CACHE_MAX_STALE_MS,
  onRefreshError: (key, err) => log.error({ err, key }, 'Failed to refresh subgraph pool cache; serving stale pools'),
})

export class AWSSubgraphProvider<TSubgraphPool extends V2SubgraphPool | V3SubgraphPool> {
  constructor(private chain: ChainId, private protocol: Protocol, private bucket: string, private baseKey: string) {}

  public async getPools(): Promise<TSubgraphPool[]> {
    log.info(`In new AWS subgraph provider for protocol ${this.protocol}`)

    const cacheKey = `${this.bucket}:${S3_POOL_CACHE_KEY(this.baseKey, this.chain, this.protocol)}`

    return POOL_CACHE.get(cacheKey, async () => {
      log.info(
        { bucket: this.bucket, key: this.baseKey },
        `Subgraph pools cache refresh for protocol ${this.protocol}. Getting subgraph pools from S3`
      )

      return fetchPoolsFromS3<TSubgraphPool>(this.bucket, this.baseKey, this.chain, this.protocol)
    })
  }
}

const fetchPoolsFromS3 = async <TSubgraphPool>(
  bucket: string,
  baseKey: string,
  chainId: ChainId,
  protocol: Protocol
) => {
  const key = S3_POOL_CACHE_KEY(baseKey, chainId, protocol)

  let result
  try {
    result = await s3Client.getObject({ Key: key, Bucket: bucket }).promise()
  } catch (err) {
    log.error({ bucket, key, err }, `Failed to get pools from S3 for ${protocol} on chain ${chainId}`)
    throw new Error(`Failed to get pools from S3 for ${protocol} on chain ${chainId}`)
  }

  const { Body: poolsBuffer } = result

  if (!poolsBuffer) {
    throw new Error(`Could not get subgraph pool cache from S3 for protocol ${protocol} on chain ${chainId}`)
  }

  const pools = JSON.parse(poolsBuffer.toString('utf-8')) as TSubgraphPool[]

  log.info({ bucket, key }, `Got subgraph pools from S3 for protocol ${protocol} on ${chainId}. Num: ${pools.length}`)

  return pools
}

export class V3AWSSubgraphProvider extends AWSSubgraphProvider<V3SubgraphPool> implements IV3SubgraphProvider {
  constructor(chainId: ChainId, bucket: string, baseKey: string) {
    super(chainId, Protocol.V3, bucket, baseKey)
  }

  public static async EagerBuild(bucket: string, baseKey: string, chainId: ChainId): Promise<V3AWSSubgraphProvider> {
    const provider = new V3AWSSubgraphProvider(chainId, bucket, baseKey)
    await provider.getPools()

    return provider
  }
}

export class V2AWSSubgraphProvider extends AWSSubgraphProvider<V2SubgraphPool> implements IV2SubgraphProvider {
  constructor(chainId: ChainId, bucket: string, key: string) {
    super(chainId, Protocol.V2, bucket, key)
  }

  public static async EagerBuild(bucket: string, baseKey: string, chainId: ChainId): Promise<V2AWSSubgraphProvider> {
    const provider = new V2AWSSubgraphProvider(chainId, bucket, baseKey)
    await provider.getPools()

    return provider
  }
}
