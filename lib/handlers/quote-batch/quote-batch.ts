import Joi from '@hapi/joi'
import { Currency, CurrencyAmount, TradeType } from '@uniswap/sdk-core'
import {
  AlphaRouterConfig,
  ChainId,
  IRouter,
  ITokenListProvider,
  ITokenProvider,
  MetricLoggerUnit,
} from 'v-swap-smart-order-router'
import JSBI from 'jsbi'
import Logger from 'bunyan'
import { APIGLambdaHandler, ErrorResponse, HandleRequestParams, Response } from '../handler'
import { ContainerInjected, RequestInjected } from '../injector-sor'
import { BATCH_ROUTING_CONFIG, tokenStringToCurrency } from '../shared'
import {
  QuoteBatchBody,
  QuoteBatchBodyJoi,
  QuoteBatchFailure,
  QuoteBatchResponse,
  QuoteBatchResponseSchemaJoi,
  QuoteBatchResultBase,
  QuoteBatchSuccess,
  QuoteRequest,
} from './schema/quote-batch-schema'

const failure = (echo: QuoteBatchResultBase, errorCode: string, detail: string): QuoteBatchFailure => ({
  ...echo,
  status: 'error',
  errorCode,
  detail,
})

export class QuoteBatchHandler extends APIGLambdaHandler<
  ContainerInjected,
  RequestInjected<IRouter<AlphaRouterConfig>>,
  QuoteBatchBody,
  void,
  QuoteBatchResponse
> {
  public async handleRequest(
    params: HandleRequestParams<ContainerInjected, RequestInjected<IRouter<AlphaRouterConfig>>, QuoteBatchBody, void>
  ): Promise<Response<QuoteBatchResponse> | ErrorResponse> {
    const {
      requestBody: { quotes },
      requestInjected: { router, log, chainId, tokenProvider, tokenListProvider, metric },
    } = params

    metric.putMetric(`GET_QUOTE_BATCH_REQUESTED_CHAINID: ${chainId}`, 1, MetricLoggerUnit.Count)
    metric.putMetric('GET_QUOTE_BATCH_SIZE', quotes.length, MetricLoggerUnit.None)

    // A reward list repeats the same handful of tokens, so resolve each one once
    // rather than twice per pair.
    const currencies = await this.resolveTokens(quotes, tokenListProvider, tokenProvider, chainId, log)
    const routingConfig = BATCH_ROUTING_CONFIG(chainId)

    const results = await Promise.all(
      quotes.map((request) => this.quoteOne(request, router, currencies, routingConfig, log))
    )

    const succeeded = results.filter((result) => result.status === 'ok').length
    metric.putMetric('GET_QUOTE_BATCH_ITEMS_OK', succeeded, MetricLoggerUnit.Count)
    metric.putMetric('GET_QUOTE_BATCH_ITEMS_FAILED', results.length - succeeded, MetricLoggerUnit.Count)

    // One bad pair must not fail the rest: a batch is a price list, and a token
    // without a pool is a normal entry in it, not a transport error.
    return { statusCode: 200, body: { quotes: results } }
  }

  private async quoteOne(
    request: QuoteRequest,
    router: IRouter<AlphaRouterConfig>,
    currencies: Map<string, Currency | undefined>,
    routingConfig: AlphaRouterConfig,
    log: Logger
  ): Promise<QuoteBatchSuccess | QuoteBatchFailure> {
    const echo: QuoteBatchResultBase = {
      tokenInAddress: request.tokenInAddress,
      tokenOutAddress: request.tokenOutAddress,
      amount: request.amount,
      type: request.type,
    }

    const tokenIn = currencies.get(request.tokenInAddress.toLowerCase())
    if (!tokenIn) {
      return failure(echo, 'TOKEN_IN_INVALID', `Could not find token with address "${request.tokenInAddress}"`)
    }

    const tokenOut = currencies.get(request.tokenOutAddress.toLowerCase())
    if (!tokenOut) {
      return failure(echo, 'TOKEN_OUT_INVALID', `Could not find token with address "${request.tokenOutAddress}"`)
    }

    if (tokenIn.equals(tokenOut)) {
      return failure(echo, 'TOKEN_IN_OUT_SAME', 'tokenIn and tokenOut must be different')
    }

    const exactIn = request.type === 'exactIn'
    const amount = CurrencyAmount.fromRawAmount(exactIn ? tokenIn : tokenOut, JSBI.BigInt(request.amount))

    try {
      const swapRoute = await router.route(
        amount,
        exactIn ? tokenOut : tokenIn,
        exactIn ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
        // No swap options: no recipient, no simulation, no calldata.
        undefined,
        routingConfig
      )

      if (!swapRoute) {
        return failure(echo, 'NO_ROUTE', 'No route found')
      }

      return {
        ...echo,
        status: 'ok',
        amountDecimals: amount.toExact(),
        blockNumber: swapRoute.blockNumber.toString(),
        quote: swapRoute.quote.quotient.toString(),
        quoteDecimals: swapRoute.quote.toExact(),
      }
    } catch (err) {
      log.error({ err, ...echo }, 'Batch quote failed')
      return failure(echo, 'QUOTE_ERROR', 'Failed to compute a quote')
    }
  }

  private async resolveTokens(
    quotes: QuoteRequest[],
    tokenListProvider: ITokenListProvider,
    tokenProvider: ITokenProvider,
    chainId: ChainId,
    log: Logger
  ): Promise<Map<string, Currency | undefined>> {
    // Keep the caller's spelling for the lookup (symbols are case sensitive) but
    // key the result by lower-cased address so mixed-case duplicates collapse.
    const spellings = new Map<string, string>()
    for (const quote of quotes) {
      for (const token of [quote.tokenInAddress, quote.tokenOutAddress]) {
        if (!spellings.has(token.toLowerCase())) {
          spellings.set(token.toLowerCase(), token)
        }
      }
    }

    const resolved = await Promise.all(
      Array.from(spellings, async ([key, token]) => {
        const currency = await tokenStringToCurrency(tokenListProvider, tokenProvider, token, chainId, log)
        return [key, currency] as const
      })
    )

    return new Map(resolved)
  }

  protected requestBodySchema(): Joi.ObjectSchema | null {
    return QuoteBatchBodyJoi
  }

  protected requestQueryParamsSchema(): Joi.ObjectSchema | null {
    return null
  }

  protected responseBodySchema(): Joi.ObjectSchema | null {
    return QuoteBatchResponseSchemaJoi
  }
}
