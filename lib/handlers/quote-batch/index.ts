import { configureHttpKeepAlive } from '../../util/http-keep-alive'
import { QuoteBatchHandlerInjector } from './injector'
import { QuoteBatchHandler } from './quote-batch'

configureHttpKeepAlive()

const quoteBatchInjectorPromise = new QuoteBatchHandlerInjector('quoteBatchInjector').build()
const quoteBatchHandler = new QuoteBatchHandler('quote-batch', quoteBatchInjectorPromise)

module.exports = {
  quoteBatchHandler: quoteBatchHandler.handler,
}
