import BaseJoi from '@hapi/joi'
import { SUPPORTED_CHAINS } from '../../injector-sor'

// Each quote costs a multicall plus a routing pass, so the cap is about keeping
// one request inside the 29s lambda budget rather than about payload size.
export const MAX_QUOTES_PER_BATCH = 20

const QuoteRequestJoi = BaseJoi.object({
  tokenInAddress: BaseJoi.string().alphanum().max(42).required(),
  tokenOutAddress: BaseJoi.string().alphanum().max(42).required(),
  amount: BaseJoi.string()
    .pattern(/^[0-9]+$/)
    .max(77)
    .required(),
  type: BaseJoi.string().valid('exactIn', 'exactOut').required(),
})

export const QuoteBatchBodyJoi = BaseJoi.object({
  chainId: BaseJoi.number()
    .valid(...SUPPORTED_CHAINS.values())
    .required(),
  quotes: BaseJoi.array().items(QuoteRequestJoi).min(1).max(MAX_QUOTES_PER_BATCH).required(),
}).required()

export type QuoteRequest = {
  tokenInAddress: string
  tokenOutAddress: string
  amount: string
  type: 'exactIn' | 'exactOut'
}

export type QuoteBatchBody = {
  chainId: number
  quotes: QuoteRequest[]
}

export type QuoteBatchResultBase = {
  tokenInAddress: string
  tokenOutAddress: string
  amount: string
  type: 'exactIn' | 'exactOut'
}

// No methodParameters on purpose: these quotes come from a single-amount config
// that is cheap enough to batch but is not what a swap should be executed on.
export type QuoteBatchSuccess = QuoteBatchResultBase & {
  status: 'ok'
  amountDecimals: string
  blockNumber: string
  quote: string
  quoteDecimals: string
}

export type QuoteBatchFailure = QuoteBatchResultBase & {
  status: 'error'
  errorCode: string
  detail: string
}

export type QuoteBatchResponse = {
  quotes: Array<QuoteBatchSuccess | QuoteBatchFailure>
}

const QuoteResultBaseJoi = {
  tokenInAddress: BaseJoi.string().required(),
  tokenOutAddress: BaseJoi.string().required(),
  amount: BaseJoi.string().required(),
  type: BaseJoi.string().valid('exactIn', 'exactOut').required(),
}

export const QuoteBatchResponseSchemaJoi = BaseJoi.object().keys({
  quotes: BaseJoi.array()
    .items(
      BaseJoi.alternatives().try(
        BaseJoi.object().keys({
          ...QuoteResultBaseJoi,
          status: BaseJoi.string().valid('ok').required(),
          amountDecimals: BaseJoi.string().required(),
          blockNumber: BaseJoi.string().required(),
          quote: BaseJoi.string().required(),
          quoteDecimals: BaseJoi.string().required(),
        }),
        BaseJoi.object().keys({
          ...QuoteResultBaseJoi,
          status: BaseJoi.string().valid('error').required(),
          errorCode: BaseJoi.string().required(),
          detail: BaseJoi.string().required(),
        })
      )
    )
    .required(),
})
