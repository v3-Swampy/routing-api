import {
  CachingTokenListProvider,
  ChainId,
  ITokenListProvider,
  ITokenProvider,
  log,
  NodeJSCache,
} from 'v-swap-smart-order-router'
import { TokenList } from '@uniswap/token-lists'
import NodeCache from 'node-cache'
import { s3Client } from '../../util/s3'

const TOKEN_LIST_CACHE = new NodeCache({ stdTTL: 600, useClones: false })
let pendingTokenList: Promise<TokenList> | undefined

const getTokenList = async (bucket: string, tokenListURI: string): Promise<TokenList> => {
  const cachedTokenList = TOKEN_LIST_CACHE.get<TokenList>(tokenListURI)
  if (cachedTokenList) {
    return cachedTokenList
  }

  // All chain initializers start at once. Share their S3 request instead of
  // sending one identical GET per chain.
  if (!pendingTokenList) {
    pendingTokenList = (async () => {
      log.info(`Getting tokenLists from s3.`)
      const tokenListResult = await s3Client
        .getObject({ Key: encodeURIComponent(tokenListURI), Bucket: bucket })
        .promise()

      const { Body: tokenListBuffer } = tokenListResult
      if (!tokenListBuffer) {
        throw new Error(`Empty token list returned from S3 for ${tokenListURI}`)
      }

      const tokenList = JSON.parse(tokenListBuffer.toString('utf-8')) as TokenList
      log.info(`Got tokenList from s3. ${tokenList.tokens.length} tokens in main list.`)
      TOKEN_LIST_CACHE.set<TokenList>(tokenListURI, tokenList)
      return tokenList
    })().finally(() => {
      pendingTokenList = undefined
    })
  }

  return pendingTokenList
}

export class AWSTokenListProvider extends CachingTokenListProvider {
  public static async fromTokenListS3Bucket(
    chainId: ChainId,
    bucket: string,
    tokenListURI: string
  ): Promise<ITokenListProvider & ITokenProvider> {
    const tokenCache = new NodeCache({ stdTTL: 360, useClones: false })

    try {
      const tokenList = await getTokenList(bucket, tokenListURI)
      return super.fromTokenList(chainId, tokenList, new NodeJSCache(tokenCache))
    } catch (err) {
      log.info({ err }, `Failed to get tokenLists from s3.`)
      return super.fromTokenListURI(chainId, tokenListURI, new NodeJSCache(tokenCache))
    }
  }
}
