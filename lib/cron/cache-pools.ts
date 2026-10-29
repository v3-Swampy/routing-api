import { Protocol } from '@uniswap/router-sdk'
import { setGlobalLogger } from 'v-swap-smart-order-router'
import { EventBridgeEvent, ScheduledHandler } from 'aws-lambda'
import { default as bunyan, default as Logger } from 'bunyan'
import { S3_POOL_CACHE_KEY } from '../util/pool-cache-key'
import { s3Client } from '../util/s3'
import { chainProtocols } from './cache-config'

const handler: ScheduledHandler = async (event: EventBridgeEvent<string, void>) => {
  const chainId = Number(process.env.chainId)
  const protocol = process.env.protocol as Protocol
  const log: Logger = bunyan.createLogger({
    name: 'RoutingLambda',
    serializers: bunyan.stdSerializers,
    level: 'info',
    requestId: event.id,
  })
  setGlobalLogger(log)

  const config = chainProtocols.find((entry) => entry.protocol === protocol && entry.chainId === chainId)
  if (!config) {
    throw new Error(`No pool source configured for protocol ${process.env.protocol} on chain ${process.env.chainId}`)
  }

  log.info(`Getting pools for ${protocol} on ${chainId}`)

  let pools
  try {
    pools = await config.provider.getPools()
  } catch (err) {
    log.error({ err }, `Failed to get pools for ${protocol} on ${chainId}`)
    throw new Error(`Failed to get pools for ${protocol} on ${chainId}`)
  }

  if (!pools || pools.length == 0) {
    log.info(`No ${protocol} pools found from the subgraph for ${chainId.toString()}`)
    return
  }

  const key = S3_POOL_CACHE_KEY(process.env.POOL_CACHE_KEY!, chainId, protocol)

  log.info(`Got ${pools.length} ${protocol} pools from the subgraph for ${chainId.toString()}. Saving to ${key}`)

  const result = await s3Client
    .putObject({
      Bucket: process.env.POOL_CACHE_BUCKET_2!,
      Key: key,
      Body: JSON.stringify(pools),
    })
    .promise()

  log.info({ result }, `Done ${protocol} for ${chainId.toString()}`)

  log.info(`Successfully cached ${chainId} ${protocol} pools to S3`)
}

module.exports = { handler }
