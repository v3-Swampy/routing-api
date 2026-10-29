import http from 'http'
import https from 'https'

const MAX_SOCKETS = 128
const MAX_FREE_SOCKETS = 32
const IDLE_TIMEOUT_MS = 10_000

/**
 * Lambda's Node 14 runtime uses non-keep-alive global agents by default, so
 * every RPC/Tenderly/S3 call pays a new TCP + TLS handshake. Reusing sockets
 * across invocations removes that handshake from the quote hot path.
 *
 * Idle sockets are closed before a container can be frozen with a connection
 * that an upstream load balancer has already dropped.
 */
export const configureHttpKeepAlive = (): void => {
  http.globalAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    timeout: IDLE_TIMEOUT_MS,
    maxSockets: MAX_SOCKETS,
    maxFreeSockets: MAX_FREE_SOCKETS,
  })
  https.globalAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    timeout: IDLE_TIMEOUT_MS,
    maxSockets: MAX_SOCKETS,
    maxFreeSockets: MAX_FREE_SOCKETS,
  })
}
