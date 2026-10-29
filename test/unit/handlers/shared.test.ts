import { expect } from 'chai'
import { ChainId } from 'v-swap-smart-order-router'
import { DEFAULT_ROUTING_CONFIG_BY_CHAIN } from '../../../lib/handlers/shared'

describe('DEFAULT_ROUTING_CONFIG_BY_CHAIN', () => {
  // Conflux used to carry its own entry here. Raising its amount steps to 25
  // cut the quote phase roughly in half but priced every split on a four point
  // grid, which is a real loss for the pairs this deployment serves, so it went
  // back to the default. Pin that so the next attempt starts from evidence.
  it('keeps Conflux on the default amount steps', () => {
    const standard = DEFAULT_ROUTING_CONFIG_BY_CHAIN(ChainId.MAINNET)
    const cfx = DEFAULT_ROUTING_CONFIG_BY_CHAIN(ChainId.CFX)

    expect(cfx.distributionPercent).to.equal(5)
    expect(DEFAULT_ROUTING_CONFIG_BY_CHAIN(ChainId.CFX_TEST).distributionPercent).to.equal(5)
    expect(cfx).to.deep.equal(standard)
  })
})
