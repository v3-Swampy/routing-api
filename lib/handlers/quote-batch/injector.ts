import { AlphaRouterConfig, ID_TO_CHAIN_ID, IRouter, setGlobalLogger, setGlobalMetric } from 'v-swap-smart-order-router'
import { MetricsLogger } from 'aws-embedded-metrics'
import { APIGatewayProxyEvent, Context } from 'aws-lambda'
import { default as bunyan, default as Logger } from 'bunyan'
import { ContainerInjected, InjectorSOR, RequestInjected } from '../injector-sor'
import { AWSMetricsLogger } from '../router-entities/aws-metrics-logger'
import { buildAlphaRouter } from '../router-factory'
import { QuoteBatchBody } from './schema/quote-batch-schema'

export class QuoteBatchHandlerInjector extends InjectorSOR<IRouter<AlphaRouterConfig>, void, QuoteBatchBody> {
  public async getRequestInjected(
    containerInjected: ContainerInjected,
    requestBody: QuoteBatchBody,
    _requestQueryParams: void,
    _event: APIGatewayProxyEvent,
    context: Context,
    log: Logger,
    metricsLogger: MetricsLogger
  ): Promise<RequestInjected<IRouter<AlphaRouterConfig>>> {
    const requestId = context.awsRequestId
    const quoteId = requestId.substring(0, 5)

    // The batch is single-chain by construction: one router, one set of pools.
    const chainIdEnum = ID_TO_CHAIN_ID(requestBody.chainId)

    log = log.child({
      serializers: bunyan.stdSerializers,
      level: bunyan.INFO,
      requestId,
      quoteId,
      chainId: chainIdEnum,
      batchSize: requestBody.quotes.length,
    })
    setGlobalLogger(log)

    metricsLogger.setNamespace('Uniswap')
    metricsLogger.setDimensions({ Service: 'RoutingAPI' })
    const metric = new AWSMetricsLogger(metricsLogger)
    setGlobalMetric(metric)

    const dependencies = await containerInjected.getDependencies(chainIdEnum)

    if (!dependencies) {
      // Request validation should prevent reject unsupported chains with 4xx already, so this should not be possible.
      throw new Error(`No container injected dependencies for chain: ${chainIdEnum}`)
    }

    return {
      chainId: chainIdEnum,
      id: quoteId,
      log,
      metric,
      router: buildAlphaRouter(dependencies, chainIdEnum),
      v3PoolProvider: dependencies.v3PoolProvider,
      v2PoolProvider: dependencies.v2PoolProvider,
      tokenProvider: dependencies.tokenProvider,
      tokenListProvider: dependencies.tokenListProvider,
    }
  }
}
