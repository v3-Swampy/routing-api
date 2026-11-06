import {
  AlphaRouterConfig,
  ID_TO_CHAIN_ID,
  ISwapToRatio,
  setGlobalLogger,
  setGlobalMetric,
  SwapAndAddConfig,
} from 'v-swap-smart-order-router'
import { MetricsLogger } from 'aws-embedded-metrics'
import { APIGatewayProxyEvent, Context } from 'aws-lambda'
import { default as bunyan, default as Logger } from 'bunyan'
import { ContainerInjected, InjectorSOR, RequestInjected } from '../injector-sor'
import { AWSMetricsLogger } from '../router-entities/aws-metrics-logger'
import { buildAlphaRouter } from '../router-factory'
import { QuoteToRatioQueryParams } from './schema/quote-to-ratio-schema'

export class QuoteToRatioHandlerInjector extends InjectorSOR<
  ISwapToRatio<AlphaRouterConfig, SwapAndAddConfig>,
  QuoteToRatioQueryParams
> {
  public async getRequestInjected(
    containerInjected: ContainerInjected,
    _requestBody: void,
    requestQueryParams: QuoteToRatioQueryParams,
    _event: APIGatewayProxyEvent,
    context: Context,
    log: Logger,
    metricsLogger: MetricsLogger
  ): Promise<RequestInjected<ISwapToRatio<AlphaRouterConfig, SwapAndAddConfig>>> {
    const requestId = context.awsRequestId
    const quoteId = requestId.substring(0, 5)
    const logLevel = bunyan.INFO

    const {
      token0Address,
      token0ChainId,
      token1Address,
      token1ChainId,
      token0Balance,
      token1Balance,
      tickLower,
      tickUpper,
      gasPriceWei,
    } = requestQueryParams

    log = log.child({
      serializers: bunyan.stdSerializers,
      level: logLevel,
      token0Address,
      token0ChainId,
      token1Address,
      token1ChainId,
      token0Balance,
      token1Balance,
      tickLower,
      tickUpper,
    })
    setGlobalLogger(log)

    metricsLogger.setNamespace('Uniswap')
    metricsLogger.setDimensions({ Service: 'RoutingAPI' })
    const metric = new AWSMetricsLogger(metricsLogger)
    setGlobalMetric(metric)

    // Today API is restricted such that both tokens must be on the same chain.
    const chainId = token0ChainId
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
      router: buildAlphaRouter(dependencies, chainIdEnum, { gasPriceWei }),
      v3PoolProvider: dependencies.v3PoolProvider,
      v2PoolProvider: dependencies.v2PoolProvider,
      tokenProvider: dependencies.tokenProvider,
      tokenListProvider: dependencies.tokenListProvider,
    }
  }
}
