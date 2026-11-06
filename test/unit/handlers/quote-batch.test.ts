import { expect } from 'chai'
import { CurrencyAmount, Token } from '@uniswap/sdk-core'
import { BigNumber } from 'ethers'
import { AlphaRouterConfig, ChainId, IRouter } from 'v-swap-smart-order-router'
import { QuoteBatchHandler } from '../../../lib/handlers/quote-batch/quote-batch'
import {
  QuoteBatchBodyJoi,
  QuoteBatchResponse,
  QuoteBatchResponseSchemaJoi,
} from '../../../lib/handlers/quote-batch/schema/quote-batch-schema'
import { RequestInjected } from '../../../lib/handlers/injector-sor'

const USDT = new Token(ChainId.CFX, '0xfe97e85d13abd9c1c33384e796f10b73905637ce', 18, 'USDT')
const REWARD = new Token(ChainId.CFX, '0x70bfd7f7eadf9b9827541272589a6b2bb760ae2e', 18, 'REWARD')
const UNROUTABLE = new Token(ChainId.CFX, '0x1111111111111111111111111111111111111111', 18, 'NOPOOL')

const log = { info: () => {}, error: () => {}, child: () => log } as any

const tokensByAddress = new Map([
  [USDT.address.toLowerCase(), USDT],
  [REWARD.address.toLowerCase(), REWARD],
  [UNROUTABLE.address.toLowerCase(), UNROUTABLE],
])

let resolveCalls: string[] = []

const tokenListProvider = {
  getTokenByAddress: async (address: string) => {
    resolveCalls.push(address.toLowerCase())
    return tokensByAddress.get(address.toLowerCase())
  },
  getTokenBySymbol: async () => undefined,
} as any

const tokenProvider = {
  getTokens: async () => ({ getTokenByAddress: () => undefined }),
} as any

const requestInjected = (router: IRouter<AlphaRouterConfig>) =>
  ({
    chainId: ChainId.CFX,
    id: 'quote',
    log,
    metric: { putMetric: () => {} },
    router,
    tokenProvider,
    tokenListProvider,
  } as unknown as RequestInjected<IRouter<AlphaRouterConfig>>)

const run = async (router: IRouter<AlphaRouterConfig>, quotes: any[]): Promise<QuoteBatchResponse> => {
  const handler = new QuoteBatchHandler('quote-batch-test', undefined as any)

  const response = await handler.handleRequest({
    context: {} as any,
    event: {} as any,
    containerInjected: {} as any,
    requestInjected: requestInjected(router),
    requestBody: { chainId: ChainId.CFX, quotes },
    requestQueryParams: undefined,
  } as any)

  const body = (response as any).body as QuoteBatchResponse

  // Every case goes through the response schema the lambda validates with,
  // otherwise a shape change would only show up as a 500 in production.
  const { error } = QuoteBatchResponseSchemaJoi.validate(body)
  expect(error, JSON.stringify(error?.details)).to.be.undefined

  return body
}

const pair = (tokenIn: Token, tokenOut: Token, amount = '1000000000000000000') => ({
  tokenInAddress: tokenIn.address,
  tokenOutAddress: tokenOut.address,
  amount,
  type: 'exactIn' as const,
})

const okRouter = (_out: Token, rawQuote = '2000000') =>
  ({
    route: async (_amount: CurrencyAmount<any>, quoteCurrency: any) => ({
      quote: CurrencyAmount.fromRawAmount(quoteCurrency, rawQuote),
      blockNumber: BigNumber.from(42),
    }),
  } as unknown as IRouter<AlphaRouterConfig>)

describe('QuoteBatchHandler', () => {
  beforeEach(() => {
    resolveCalls = []
  })

  it('returns one result per pair and keeps a bad pair from failing the rest', async () => {
    const body = await run(okRouter(USDT), [
      pair(REWARD, USDT),
      { ...pair(USDT, USDT), tokenInAddress: '0x2222222222222222222222222222222222222222' },
    ])

    expect(body.quotes).to.have.length(2)
    expect(body.quotes[0].status).to.equal('ok')
    expect(body.quotes[1]).to.include({ status: 'error', errorCode: 'TOKEN_IN_INVALID' })
  })

  it('reports rejected and identical pairs per item', async () => {
    const body = await run(okRouter(USDT), [pair(USDT, USDT), pair(UNROUTABLE, USDT)])

    expect(body.quotes[0]).to.include({ status: 'error', errorCode: 'TOKEN_IN_OUT_SAME' })
    expect(body.quotes[1].status).to.equal('ok')
  })

  it('turns a null route into NO_ROUTE instead of an empty quote', async () => {
    const body = await run({ route: async () => null } as any, [pair(REWARD, USDT)])

    expect(body.quotes[0]).to.include({ status: 'error', errorCode: 'NO_ROUTE' })
  })

  it('isolates a router exception to its own item', async () => {
    let call = 0
    const router = {
      route: async () => {
        call++
        if (call === 1) throw new Error('provider exploded')
        return { quote: CurrencyAmount.fromRawAmount(USDT, '2000000'), blockNumber: BigNumber.from(42) }
      },
    } as unknown as IRouter<AlphaRouterConfig>

    const body = await run(router, [pair(REWARD, USDT), pair(REWARD, USDT, '2000000000000000000')])

    expect(body.quotes[0]).to.include({ status: 'error', errorCode: 'QUOTE_ERROR' })
    expect(body.quotes[1].status).to.equal('ok')
  })

  it('returns amounts but never calldata', async () => {
    const body = await run(okRouter(USDT, '2500000'), [pair(REWARD, USDT)])

    expect(body.quotes[0]).to.deep.equal({
      tokenInAddress: REWARD.address,
      tokenOutAddress: USDT.address,
      amount: '1000000000000000000',
      type: 'exactIn',
      status: 'ok',
      amountDecimals: '1',
      blockNumber: '42',
      quote: '2500000',
      quoteDecimals: '0.0000000000025',
    })
  })

  it('resolves each distinct token once per batch', async () => {
    await run(okRouter(USDT), [pair(REWARD, USDT), pair(REWARD, USDT, '2'), pair(USDT, REWARD)])

    expect(resolveCalls).to.have.members([REWARD.address.toLowerCase(), USDT.address.toLowerCase()])
  })
})

describe('QuoteBatchBodyJoi', () => {
  const valid = { chainId: ChainId.CFX, quotes: [pair(REWARD, USDT)] }

  it('rejects a body that is missing or empty', () => {
    expect(QuoteBatchBodyJoi.validate(undefined).error).to.not.be.undefined
    expect(QuoteBatchBodyJoi.validate({ chainId: ChainId.CFX, quotes: [] }).error).to.not.be.undefined
  })

  it('rejects more pairs than the lambda budget allows', () => {
    const quotes = new Array(21).fill(pair(REWARD, USDT))
    expect(QuoteBatchBodyJoi.validate({ ...valid, quotes }).error).to.not.be.undefined
  })

  it('rejects an unsupported chain', () => {
    expect(QuoteBatchBodyJoi.validate({ ...valid, chainId: 999999 }).error).to.not.be.undefined
  })
})

describe('QuoteBatchResponseSchemaJoi', () => {
  it('accepts a mixed batch of ok and error results', () => {
    const body = {
      quotes: [
        {
          tokenInAddress: REWARD.address,
          tokenOutAddress: USDT.address,
          amount: '1',
          type: 'exactIn',
          status: 'ok',
          amountDecimals: '1',
          blockNumber: '42',
          quote: '2',
          quoteDecimals: '2',
        },
        {
          tokenInAddress: UNROUTABLE.address,
          tokenOutAddress: USDT.address,
          amount: '1',
          type: 'exactIn',
          status: 'error',
          errorCode: 'NO_ROUTE',
          detail: 'No route found',
        },
      ],
    }

    const { error } = QuoteBatchResponseSchemaJoi.validate(body)
    expect(error).to.be.undefined
  })
})
