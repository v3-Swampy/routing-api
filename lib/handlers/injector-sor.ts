import { Token } from '@uniswap/sdk-core'
import {
  BatchParams,
  BlockNumberConfig,
  CachingGasStationProvider,
  CachingTokenListProvider,
  CachingTokenProviderWithFallback,
  CachingV3PoolProvider,
  ChainId,
  EIP1559GasPriceProvider,
  FallbackTenderlySimulator,
  FailureOverrides,
  TenderlySimulator,
  EthEstimateGasSimulator,
  IGasPriceProvider,
  IMetric,
  Simulator,
  ITokenListProvider,
  ITokenProvider,
  IV2PoolProvider,
  IV2SubgraphProvider,
  IV3PoolProvider,
  IV3SubgraphProvider,
  LegacyGasPriceProvider,
  NodeJSCache,
  OnChainGasPriceProvider,
  OnChainQuoteProvider,
  QuoteRetryOptions,
  setGlobalLogger,
  StaticV2SubgraphProvider,
  StaticV3SubgraphProvider,
  TokenProvider,
  UniswapMulticallProvider,
  V2PoolProvider,
  V2QuoteProvider,
  V3PoolProvider,
} from 'v-swap-smart-order-router'
import { TokenList } from '@uniswap/token-lists'
import { default as bunyan, default as Logger } from 'bunyan'
import { ethers } from 'ethers'
import NodeCache from 'node-cache'
import { LazyAsyncMap } from '../util/lazy-async-map'
import UNSUPPORTED_TOKEN_LIST from './../config/unsupported.tokenlist.json'
import { BaseRInj, Injector } from './handler'
import { V2AWSSubgraphProvider, V3AWSSubgraphProvider } from './router-entities/aws-subgraph-provider'
import { AWSTokenListProvider } from './router-entities/aws-token-list-provider'
import { PairCachingV3SubgraphProvider } from './router-entities/pair-caching-subgraph-provider'

export const SUPPORTED_CHAINS: ChainId[] = [
  ChainId.MAINNET,
  ChainId.RINKEBY,
  ChainId.ROPSTEN,
  ChainId.KOVAN,
  ChainId.OPTIMISM,
  ChainId.OPTIMISTIC_KOVAN,
  ChainId.ARBITRUM_ONE,
  ChainId.ARBITRUM_RINKEBY,
  ChainId.ARBITRUM_GOERLI,
  ChainId.POLYGON,
  ChainId.POLYGON_MUMBAI,
  ChainId.GÖRLI,
  ChainId.CELO,
  ChainId.CELO_ALFAJORES,
  ChainId.BSC,
  ChainId.CFX,
  ChainId.CFX_TEST,
]
const DEFAULT_TOKEN_LIST = 'https://gateway.ipfs.io/ipns/tokens.uniswap.org'

type QuoteProviderProfile = {
  batchParams: BatchParams
  gasErrorFailureOverride: FailureOverrides
  successRateFailureOverrides: FailureOverrides
  blockNumberConfig?: BlockNumberConfig
}

const QUOTE_RETRY_OPTIONS: QuoteRetryOptions = { retries: 2, minTimeout: 100, maxTimeout: 1000 }

const OPTIMISM_QUOTE_PROFILE: QuoteProviderProfile = {
  batchParams: { multicallChunk: 110, gasLimitPerCall: 1_200_000, quoteMinSuccessRate: 0.1 },
  gasErrorFailureOverride: { gasLimitOverride: 3_000_000, multicallChunk: 45 },
  successRateFailureOverrides: { gasLimitOverride: 3_000_000, multicallChunk: 45 },
  blockNumberConfig: {
    baseBlockOffset: -25,
    rollback: { enabled: true, attemptsBeforeRollback: 1, rollbackBlockOffset: -20 },
  },
}

const ARBITRUM_QUOTE_PROFILE: QuoteProviderProfile = {
  batchParams: { multicallChunk: 15, gasLimitPerCall: 15_000_000, quoteMinSuccessRate: 0.15 },
  gasErrorFailureOverride: { gasLimitOverride: 30_000_000, multicallChunk: 8 },
  successRateFailureOverrides: { gasLimitOverride: 30_000_000, multicallChunk: 8 },
  blockNumberConfig: {
    baseBlockOffset: 0,
    rollback: { enabled: true, attemptsBeforeRollback: 1, rollbackBlockOffset: -10 },
  },
}

// Never overridden here, so these are the router's own numbers. Spelling them
// out means a router upgrade cannot change them silently.
const ARBITRUM_GOERLI_QUOTE_PROFILE: QuoteProviderProfile = {
  batchParams: { multicallChunk: 10, gasLimitPerCall: 12_000_000, quoteMinSuccessRate: 0.1 },
  gasErrorFailureOverride: { gasLimitOverride: 30_000_000, multicallChunk: 6 },
  successRateFailureOverrides: { gasLimitOverride: 30_000_000, multicallChunk: 6 },
}

const CELO_QUOTE_PROFILE: QuoteProviderProfile = {
  batchParams: { multicallChunk: 10, gasLimitPerCall: 5_000_000, quoteMinSuccessRate: 0.1 },
  gasErrorFailureOverride: { gasLimitOverride: 5_000_000, multicallChunk: 5 },
  successRateFailureOverrides: { gasLimitOverride: 6_250_000, multicallChunk: 4 },
}

const CFX_QUOTE_PROFILE: QuoteProviderProfile = {
  batchParams: { multicallChunk: 50, gasLimitPerCall: 505_000, quoteMinSuccessRate: 0.15 },
  gasErrorFailureOverride: { gasLimitOverride: 2_000_000, multicallChunk: 10 },
  successRateFailureOverrides: { gasLimitOverride: 2_000_000, multicallChunk: 10 },
}

// Mirrors the router's fallback so that naming a chain here never changes
// behaviour, only makes the parameters visible at the call site.
const DEFAULT_QUOTE_PROFILE: QuoteProviderProfile = {
  batchParams: { multicallChunk: 210, gasLimitPerCall: 705_000, quoteMinSuccessRate: 0.15 },
  gasErrorFailureOverride: { gasLimitOverride: 2_000_000, multicallChunk: 70 },
  successRateFailureOverrides: { gasLimitOverride: 1_300_000, multicallChunk: 110 },
}

const QUOTE_PROFILES: Partial<Record<ChainId, QuoteProviderProfile>> = {
  [ChainId.OPTIMISM]: OPTIMISM_QUOTE_PROFILE,
  [ChainId.OPTIMISTIC_KOVAN]: OPTIMISM_QUOTE_PROFILE,
  [ChainId.ARBITRUM_ONE]: ARBITRUM_QUOTE_PROFILE,
  [ChainId.ARBITRUM_RINKEBY]: ARBITRUM_QUOTE_PROFILE,
  [ChainId.ARBITRUM_GOERLI]: ARBITRUM_GOERLI_QUOTE_PROFILE,
  [ChainId.CELO]: CELO_QUOTE_PROFILE,
  [ChainId.CELO_ALFAJORES]: CELO_QUOTE_PROFILE,
  [ChainId.CFX]: CFX_QUOTE_PROFILE,
  [ChainId.CFX_TEST]: CFX_QUOTE_PROFILE,
}

export interface RequestInjected<Router> extends BaseRInj {
  chainId: ChainId
  metric: IMetric
  v3PoolProvider: IV3PoolProvider
  v2PoolProvider: IV2PoolProvider
  tokenProvider: ITokenProvider
  tokenListProvider: ITokenListProvider
  router: Router
}

export type ContainerDependencies = {
  provider: ethers.providers.JsonRpcProvider
  v3SubgraphProvider: IV3SubgraphProvider
  v2SubgraphProvider: IV2SubgraphProvider
  tokenListProvider: ITokenListProvider
  gasPriceProvider: IGasPriceProvider
  blockedTokenListProvider: ITokenListProvider
  v3PoolProvider: IV3PoolProvider
  v2PoolProvider: IV2PoolProvider
  tokenProvider: ITokenProvider
  multicallProvider: UniswapMulticallProvider
  onChainQuoteProvider: OnChainQuoteProvider
  v2QuoteProvider: V2QuoteProvider
  simulator: Simulator
}

export interface ContainerInjected {
  getDependencies(chainId: ChainId): Promise<ContainerDependencies | undefined>
}

let containerInjected: Promise<ContainerInjected> | undefined

export abstract class InjectorSOR<Router, QueryParams> extends Injector<
  ContainerInjected,
  RequestInjected<Router>,
  void,
  QueryParams
> {
  public async buildContainerInjected(): Promise<ContainerInjected> {
    if (!containerInjected) {
      const built = this.buildContainerInjectedOnce()
      containerInjected = built
      built.catch(() => {
        if (containerInjected === built) {
          containerInjected = undefined
        }
      })
    }

    return containerInjected
  }

  private async buildContainerInjectedOnce(): Promise<ContainerInjected> {
    const log: Logger = bunyan.createLogger({
      name: this.injectorName,
      serializers: bunyan.stdSerializers,
      level: bunyan.INFO,
    })
    setGlobalLogger(log)

    const { POOL_CACHE_BUCKET_2, POOL_CACHE_KEY, TOKEN_LIST_CACHE_BUCKET } = process.env

    const buildDependencies = async (chainId: ChainId): Promise<ContainerDependencies | undefined> => {
      const url = process.env[`WEB3_RPC_${chainId.toString()}`]!

      if (!url) {
        // This router instance will not be able to route through any chain
        // for which RPC URL is not set, so requests for it return a 500.
        log.fatal({ chainId: chainId }, `Fatal: No Web3 RPC endpoint set for chain`)
        return undefined
      }

      let timeout: number
      switch (chainId) {
        case ChainId.ARBITRUM_ONE:
        case ChainId.ARBITRUM_RINKEBY:
          timeout = 8000
          break
        default:
          timeout = 5000
          break
      }

      const provider = new ethers.providers.JsonRpcProvider(
        {
          url: url,
          timeout,
        },
        chainId
      )

      const tokenListProvider = await AWSTokenListProvider.fromTokenListS3Bucket(
        chainId,
        TOKEN_LIST_CACHE_BUCKET!,
        DEFAULT_TOKEN_LIST
      )

      const tokenCache = new NodeJSCache<Token>(new NodeCache({ stdTTL: 3600, useClones: false }))
      const blockedTokenCache = new NodeJSCache<Token>(new NodeCache({ stdTTL: 3600, useClones: false }))

      const multicall2Provider = new UniswapMulticallProvider(chainId, provider, 375_000)
      const tokenProvider = new CachingTokenProviderWithFallback(
        chainId,
        tokenCache,
        tokenListProvider,
        new TokenProvider(chainId, multicall2Provider)
      )

      // Some providers like Infura set a gas limit per call of 10x block gas which is approx 150m
      // 200*725k < 150m
      const quoteProfile = QUOTE_PROFILES[chainId] ?? DEFAULT_QUOTE_PROFILE
      const quoteProvider = new OnChainQuoteProvider(
        chainId,
        provider,
        multicall2Provider,
        QUOTE_RETRY_OPTIONS,
        quoteProfile.batchParams,
        quoteProfile.gasErrorFailureOverride,
        quoteProfile.successRateFailureOverrides,
        quoteProfile.blockNumberConfig
      )

      const v3PoolProvider = new CachingV3PoolProvider(
        chainId,
        new V3PoolProvider(chainId, multicall2Provider),
        new NodeJSCache(new NodeCache({ stdTTL: 180, useClones: false }))
      )

      const v2PoolProvider = new V2PoolProvider(chainId, multicall2Provider)

      const tenderlySimulator = new TenderlySimulator(
        chainId,
        'http://api.tenderly.co',
        process.env.TENDERLY_USER!,
        process.env.TENDERLY_PROJECT!,
        process.env.TENDERLY_ACCESS_KEY!,
        v2PoolProvider,
        v3PoolProvider,
        provider,
        { [ChainId.ARBITRUM_ONE]: 2.5 }
      )

      const ethEstimateGasSimulator = new EthEstimateGasSimulator(chainId, provider, v2PoolProvider, v3PoolProvider)

      const simulator = new FallbackTenderlySimulator(chainId, provider, tenderlySimulator, ethEstimateGasSimulator)

      const [v3SubgraphProvider, v2SubgraphProvider] = await Promise.all([
        (async () => {
          try {
            const subgraphProvider = await V3AWSSubgraphProvider.EagerBuild(
              POOL_CACHE_BUCKET_2!,
              POOL_CACHE_KEY!,
              chainId
            )
            return subgraphProvider
          } catch (err) {
            log.error({ err }, 'AWS Subgraph Provider unavailable, defaulting to Static Subgraph Provider')
            return new PairCachingV3SubgraphProvider(chainId, new StaticV3SubgraphProvider(chainId, v3PoolProvider))
          }
        })(),
        (async () => {
          try {
            const subgraphProvider = await V2AWSSubgraphProvider.EagerBuild(
              POOL_CACHE_BUCKET_2!,
              POOL_CACHE_KEY!,
              chainId
            )
            return subgraphProvider
          } catch (err) {
            return new StaticV2SubgraphProvider(chainId)
          }
        })(),
      ])

      return {
        provider,
        tokenListProvider,
        blockedTokenListProvider: await CachingTokenListProvider.fromTokenList(
          chainId,
          UNSUPPORTED_TOKEN_LIST as TokenList,
          blockedTokenCache
        ),
        multicallProvider: multicall2Provider,
        tokenProvider,
        gasPriceProvider: new CachingGasStationProvider(
          chainId,
          new OnChainGasPriceProvider(
            chainId,
            new EIP1559GasPriceProvider(provider),
            new LegacyGasPriceProvider(provider)
          ),
          new NodeJSCache(new NodeCache({ stdTTL: 15, useClones: false }))
        ),
        v3SubgraphProvider,
        onChainQuoteProvider: quoteProvider,
        v3PoolProvider,
        v2PoolProvider,
        v2QuoteProvider: new V2QuoteProvider(),
        v2SubgraphProvider,
        simulator,
      }
    }

    const dependencies = new LazyAsyncMap<ChainId, ContainerDependencies | undefined>(buildDependencies)

    // Mainnet carries most traffic, so warm it in the background while keeping
    // every other chain lazy. A failed warmup is retried on the next request.
    dependencies.get(ChainId.MAINNET).catch((err) => log.error({ err }, 'Failed to warm mainnet dependencies'))

    return {
      getDependencies: (chainId: ChainId) => dependencies.get(chainId),
    }
  }
}
