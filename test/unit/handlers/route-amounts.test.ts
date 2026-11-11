import { expect } from 'chai'
import JSBI from 'jsbi'
import { reconcileRouteAmounts, withReconciledNativeValue } from '../../../lib/handlers/route-amounts'
import { V3PoolInRoute } from '../../../lib/handlers/schema'

const token = { address: '0x0000000000000000000000000000000000000001', chainId: 1, symbol: 'TKN', decimals: '18' }

const pool = (amountIn?: string, amountOut?: string): V3PoolInRoute => ({
  type: 'v3-pool',
  address: '0x0000000000000000000000000000000000000002',
  tokenIn: token,
  tokenOut: token,
  sqrtRatioX96: '1',
  liquidity: '1',
  tickCurrent: '0',
  fee: '3000',
  amountIn,
  amountOut,
})

const sumField = (route: V3PoolInRoute[][], field: 'amountIn' | 'amountOut'): JSBI =>
  route.reduce(
    (total, subRoute) =>
      JSBI.add(
        total,
        JSBI.BigInt(
          (field === 'amountIn' ? subRoute[0] : subRoute[subRoute.length - 1])?.[field] ?? '0'
        )
      ),
    JSBI.BigInt(0)
  )

describe('reconcileRouteAmounts', () => {
  const amount = JSBI.BigInt('50000000000000000010')

  it('exactIn: adds the dust lost to per-route flooring to the largest route', () => {
    // 95/5 split of ...010 => ...009.5 + ...000.5, both floored => 1 drip missing.
    const route = [
      [pool('47500000000000000009'), pool(undefined, '100')],
      [pool('2500000000000000000', '50')],
    ]

    const { total, missing } = reconcileRouteAmounts(route, true, amount)

    expect(missing.toString()).to.equal('1')
    // `total` must be the pre-reconciliation sum: it is what the router's calldata spends.
    expect(total.toString()).to.equal('50000000000000000009')
    expect(route[0]![0]!.amountIn).to.equal('47500000000000000010')
    expect(route[1]![0]!.amountIn).to.equal('2500000000000000000')
    expect(sumField(route, 'amountIn').toString()).to.equal(amount.toString())
  })

  it('exactIn: compensates the largest route, not the last one', () => {
    const route = [
      [pool('2500000000000000000')],
      [pool('47500000000000000008')],
      [pool('1')],
    ]

    const { missing } = reconcileRouteAmounts(route, true, amount)

    expect(missing.toString()).to.equal('1')
    expect(route[1]![0]!.amountIn).to.equal('47500000000000000009')
    expect(route[0]![0]!.amountIn).to.equal('2500000000000000000')
    expect(route[2]![0]!.amountIn).to.equal('1')
  })

  it('exactIn: leaves an already exact split untouched', () => {
    const route = [[pool('50000000000000000010', '100')]]

    const result = reconcileRouteAmounts(route, true, amount)

    expect(result.missing.toString()).to.equal('0')
    expect(result.total.toString()).to.equal('50000000000000000010')
    expect(route[0]![0]!.amountIn).to.equal('50000000000000000010')
  })

  it('exactIn: does not shrink routes that already exceed the requested amount', () => {
    const route = [[pool('50000000000000000011', '100')]]

    const result = reconcileRouteAmounts(route, true, amount)

    expect(result.missing.toString()).to.equal('-1')
    expect(result.total.toString()).to.equal('50000000000000000011')
    expect(route[0]![0]!.amountIn).to.equal('50000000000000000011')
  })

  it('exactOut: reconciles the output edges and leaves the input quote alone', () => {
    // 75/25 split of ...010 => ...007.5 + ...002.5, both floored => 1 drip missing.
    const route = [
      [pool('200', undefined), pool(undefined, '37500000000000000007')],
      [pool('100', '12500000000000000002')],
    ]

    const { total, missing } = reconcileRouteAmounts(route, false, amount)

    expect(missing.toString()).to.equal('1')
    expect(total.toString()).to.equal('50000000000000000009')
    expect(route[0]![1]!.amountOut).to.equal('37500000000000000008')
    expect(route[1]![0]!.amountOut).to.equal('12500000000000000002')
    expect(route[0]![0]!.amountIn).to.equal('200')
    expect(sumField(route, 'amountOut').toString()).to.equal(amount.toString())
  })

  it('handles routes without edge amounts', () => {
    const route = [[pool(), pool()]]

    expect(reconcileRouteAmounts(route, true, amount).missing.toString()).to.equal('0')
    expect(reconcileRouteAmounts(route, true, amount).total.toString()).to.equal('0')
    expect(reconcileRouteAmounts([], true, amount).missing.toString()).to.equal('0')
  })
})

describe('withReconciledNativeValue', () => {
  const methodParameters = { calldata: '0xdeadbeef', value: '0x2b5e3af16b188000a', to: '0xrouter' }

  it('rewrites value to the amount the calldata actually spends', () => {
    const reconciled = withReconciledNativeValue(methodParameters, JSBI.BigInt('50000000000000000009'))

    expect(reconciled!.value).to.equal('0x2b5e3af16b1880009')
    expect(reconciled!.calldata).to.equal(methodParameters.calldata)
    expect(reconciled!.to).to.equal(methodParameters.to)
    // the input object must not be mutated: it may be shared by the caller
    expect(methodParameters.value).to.equal('0x2b5e3af16b188000a')
  })

  it('is a no-op when value already matches and when there is no methodParameters', () => {
    expect(
      withReconciledNativeValue(methodParameters, JSBI.BigInt('50000000000000000010'))
    ).to.equal(methodParameters)
    expect(withReconciledNativeValue(undefined, JSBI.BigInt('1'))).to.equal(undefined)
  })

  it('handles zero', () => {
    expect(withReconciledNativeValue(methodParameters, JSBI.BigInt(0))!.value).to.equal('0x0')
  })
})
