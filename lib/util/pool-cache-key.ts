import { Protocol } from '@uniswap/router-sdk'
import { ChainId } from 'v-swap-smart-order-router'

export const S3_POOL_CACHE_KEY = (baseKey: string, chain: ChainId, protocol: Protocol) =>
  `${baseKey}-${chain}-${protocol}`
