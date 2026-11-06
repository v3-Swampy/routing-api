import { BigNumber } from 'ethers'
import { AlphaRouter, ChainId, Simulator, V3HeuristicGasModelFactory } from 'v-swap-smart-order-router'
import { ContainerDependencies } from './injector-sor'
import { StaticGasPriceProvider } from './router-entities/static-gas-price-provider'

/**
 * Every handler builds the same router from the same per-chain dependencies.
 * Only a pinned gas price and the simulator differ between handlers, so those
 * are the only knobs here; the rest comes straight off the container.
 */
export const buildAlphaRouter = (
  dependencies: ContainerDependencies,
  chainId: ChainId,
  options: { gasPriceWei?: string; simulator?: Simulator } = {}
): AlphaRouter => {
  const { gasPriceWei, simulator } = options

  return new AlphaRouter({
    chainId,
    provider: dependencies.provider,
    v3SubgraphProvider: dependencies.v3SubgraphProvider,
    multicall2Provider: dependencies.multicallProvider,
    v3PoolProvider: dependencies.v3PoolProvider,
    onChainQuoteProvider: dependencies.onChainQuoteProvider,
    gasPriceProvider: gasPriceWei
      ? new StaticGasPriceProvider(BigNumber.from(gasPriceWei))
      : dependencies.gasPriceProvider,
    v3GasModelFactory: new V3HeuristicGasModelFactory(),
    blockedTokenListProvider: dependencies.blockedTokenListProvider,
    tokenProvider: dependencies.tokenProvider,
    v2PoolProvider: dependencies.v2PoolProvider,
    v2QuoteProvider: dependencies.v2QuoteProvider,
    v2SubgraphProvider: dependencies.v2SubgraphProvider,
    simulator,
  })
}
