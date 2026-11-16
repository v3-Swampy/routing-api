import {
  AlphaRouterConfig,
  ID_TO_CHAIN_ID,
  IRouter,
  LegacyRoutingConfig,
  setGlobalLogger,
  setGlobalMetric,
} from 'v-swap-smart-order-router'
import { MetricsLogger } from 'aws-embedded-metrics'
import { APIGatewayProxyEvent, Context } from 'aws-lambda'
import { default as bunyan, default as Logger } from 'bunyan'
import { ContainerInjected, InjectorSOR, RequestInjected } from '../injector-sor'
import { AWSMetricsLogger } from '../router-entities/aws-metrics-logger'
import { buildAlphaRouter } from '../router-factory'
import { QuoteQueryParams } from './schema/quote-schema'

export class QuoteHandlerInjector extends InjectorSOR<
  IRouter<AlphaRouterConfig | LegacyRoutingConfig>,
  QuoteQueryParams
> {
  public async getRequestInjected(
    containerInjected: ContainerInjected,
    _requestBody: void,
    requestQueryParams: QuoteQueryParams,
    _event: APIGatewayProxyEvent,
    context: Context,
    log: Logger,
    metricsLogger: MetricsLogger
  ): Promise<RequestInjected<IRouter<AlphaRouterConfig | LegacyRoutingConfig>>> {
    const requestId = context.awsRequestId
    const quoteId = requestId.substring(0, 5)
    const logLevel = bunyan.INFO

    const { tokenInAddress, tokenInChainId, tokenOutAddress, amount, type, algorithm, gasPriceWei } = requestQueryParams

    log = log.child({
      serializers: bunyan.stdSerializers,
      level: logLevel,
      requestId,
      quoteId,
      tokenInAddress,
      chainId: tokenInChainId,
      tokenOutAddress,
      amount,
      type,
      algorithm,
    })
    setGlobalLogger(log)

    metricsLogger.setNamespace('Uniswap')
    metricsLogger.setDimensions({ Service: 'RoutingAPI' })
    const metric = new AWSMetricsLogger(metricsLogger)
    setGlobalMetric(metric)

    // Today API is restricted such that both tokens must be on the same chain.
    const chainId = tokenInChainId
    const chainIdEnum = ID_TO_CHAIN_ID(chainId)

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
      router: buildAlphaRouter(dependencies, chainIdEnum, { gasPriceWei, simulator: dependencies.simulator }),
      v3PoolProvider: dependencies.v3PoolProvider,
      v2PoolProvider: dependencies.v2PoolProvider,
      tokenProvider: dependencies.tokenProvider,
      tokenListProvider: dependencies.tokenListProvider,
    }
  }
}
