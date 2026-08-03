/**
 * Per-provider RPC cost model.
 *
 * Every number here was read from the provider's own primary documentation on
 * the date in `verifiedOn`. Nothing is inferred or remembered. Where a provider
 * does not document something, the value is `null` and `notes` says so —
 * an absent number is better than a wrong one.
 *
 * Re-verify before trusting these: providers reprice without notice.
 */

export const VERIFIED_ON = '2026-08-04'

/** How each provider bills a JSON-RPC array batch. */
export const BATCH_BILLING = {
  alchemy: {
    model: 'per-method',
    envelopeSurcharge: 0,
    verified: true,
    quote: 'batch* | CU of method # times called',
    source: 'https://www.alchemy.com/docs/reference/compute-unit-costs',
  },
  infura: {
    model: 'per-method-plus-envelope',
    envelopeSurcharge: 1,
    verified: true,
    quote:
      'All requests in the array are counted as individual requests against the daily credit limit and batch itself is counted as a request. ... if the array contains 30 requests ... this would be 31 total requests.',
    source: 'https://docs.infura.io/how-to/make-batch-requests/',
  },
  ankr: {
    model: 'per-method',
    envelopeSurcharge: 0,
    verified: true,
    quote: 'every sub-call in a batch is billed and rate-limited individually',
    source: 'https://www.ankr.com/docs/rpc-service/errors/per-chain-quirks/',
  },
  quicknode: {
    model: 'per-method',
    envelopeSurcharge: 0,
    verified: 'rate-limits-only',
    quote:
      'Remember that batching also counts as CPS because each request is counted individually.',
    source: 'https://support.quicknode.com/articles/2335544672-429-errors-explained',
    notes:
      'Documented for rate limiting. Credit billing per sub-call is implied by their Multicall guide but not stated outright.',
  },
  helius: {
    model: 'undocumented',
    envelopeSurcharge: 0,
    verified: false,
    quote: null,
    source: 'https://www.helius.dev/docs/billing/credits',
    notes:
      'Helius documents NO batching discount and NO per-element batch billing rule. Do not claim either. Assumed per-method here for modelling only.',
  },
}

/** Provider metering units and rate-limit models. */
export const PROVIDERS = {
  alchemy: {
    unit: 'CU',
    chains: ['evm', 'solana'],
    rateLimitModel: 'CU/s (CUPS), token bucket over a 10s rolling window',
    tiers: {
      free: { throughput: 1000, monthly: 30_000_000, unit: 'CU' },
      payg: { throughput: 10_000, monthly: null, unit: 'CU' },
    },
    notes:
      'Alchemy docs contradict themselves on free-tier throughput: the pricing-plans table says 1,000 CU/s, the throughput page example says 500 CU/s. Do not hardcode either.',
    errorBilling:
      '429 and 403 cost 0 CU. Other 4xx/5xx STILL cost full CU for the method.',
    source: 'https://www.alchemy.com/docs/reference/compute-unit-costs',
  },
  infura: {
    unit: 'credits',
    chains: ['evm', 'solana'],
    rateLimitModel: 'credits/second',
    tiers: {
      free: { throughput: 500, daily: 3_000_000, unit: 'credits' },
      developer: { throughput: 4_000, daily: 15_000_000, unit: 'credits' },
      team: { throughput: 40_000, daily: 75_000_000, unit: 'credits' },
    },
    notes: 'Daily quota resets 00:00 UTC. No method costs 0; the floor is 5 credits.',
    errorBilling: '429 and 402 are not charged.',
    source: 'https://docs.infura.io/get-started/pricing/credit-cost/',
  },
  ankr: {
    unit: 'credits',
    chains: ['evm', 'solana'],
    rateLimitModel: 'requests/second (never credits/s)',
    tiers: {
      public: { throughput: 30, monthly: null, unit: 'requests', note: '~1800 req/min across all endpoints' },
      freemium: { throughput: 30, monthly: 200_000_000, unit: 'credits' },
      premium: { throughput: 1500, monthly: null, unit: 'credits', note: '~1.5k req/s EVM, ~4k req/s Solana, per endpoint' },
    },
    notes:
      'Flat rate: EVM 200 credits/method, Solana 500 credits/method, ALL methods. Ankr prose claims per-method variation but publishes no such table. Solana nodes retain only ~16h of history.',
    errorBilling: '429 not charged. Charged regardless of node success otherwise.',
    source: 'https://www.ankr.com/docs/rpc-service/pricing/',
  },
  quicknode: {
    unit: 'credits',
    chains: ['evm', 'solana'],
    rateLimitModel: 'credits/second (CPS)',
    tiers: {},
    notes:
      'Flat per chain: Ethereum 20/method, Solana 30/method. Advanced APIs 2x, Large Calls 4x. Per-tier CPS numbers are behind JS on the pricing page and are NOT documented here.',
    errorBilling: '4xx and 5xx are not billed.',
    source: 'https://www.quicknode.com/api-credits',
  },
  helius: {
    unit: 'credits',
    chains: ['solana'],
    rateLimitModel: 'requests/second, separate buckets for RPC / DAS / sendTransaction',
    tiers: {
      free: { throughput: 10, monthly: 1_000_000, das: 2, unit: 'credits' },
      developer: { throughput: 50, monthly: 10_000_000, das: 10, unit: 'credits' },
      business: { throughput: 200, monthly: 100_000_000, das: 50, unit: 'credits' },
      professional: { throughput: 500, monthly: 200_000_000, das: 100, unit: 'credits' },
    },
    notes:
      'getProgramAccounts has its own rate bucket: 5/25/50/75 req/s by tier. Credits do not roll over.',
    errorBilling: null,
    source: 'https://www.helius.dev/docs/billing/credits',
  },
}

/** EVM per-method cost. `null` = provider does not publish a distinct number. */
export const EVM_COSTS = {
  eth_chainId: { alchemy: 0, infura: 5, ankr: 200, quicknode: 20 },
  eth_blockNumber: { alchemy: 10, infura: 80, ankr: 200, quicknode: 20 },
  eth_call: { alchemy: 26, infura: 80, ankr: 200, quicknode: 20 },
  eth_getBalance: { alchemy: 20, infura: 80, ankr: 200, quicknode: 20 },
  eth_getCode: { alchemy: 20, infura: 80, ankr: 200, quicknode: 20 },
  eth_getStorageAt: { alchemy: 20, infura: 80, ankr: 200, quicknode: 20 },
  eth_getBlockByNumber: { alchemy: 20, infura: 80, ankr: 200, quicknode: 20 },
  eth_getTransactionReceipt: { alchemy: 20, infura: 80, ankr: 200, quicknode: 20 },
  eth_getBlockReceipts: { alchemy: 20, infura: 1000, ankr: 200, quicknode: 20 },
  eth_estimateGas: { alchemy: 20, infura: 300, ankr: 200, quicknode: 20 },
  eth_sendRawTransaction: { alchemy: 40, infura: 80, ankr: 200, quicknode: 20 },
  eth_getLogs: { alchemy: 60, infura: 255, ankr: 200, quicknode: 20 },
  txpool_content: { alchemy: 500, infura: null, ankr: 200, quicknode: 80 },
}

/** Solana per-method cost. */
export const SOLANA_COSTS = {
  getAccountInfo: { alchemy: 10, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getBalance: { alchemy: 10, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getTokenAccountsByOwner: { alchemy: 10, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getMultipleAccounts: { alchemy: 20, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getLatestBlockhash: { alchemy: 20, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getSignatureStatuses: { alchemy: 20, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getProgramAccounts: { alchemy: 20, helius: 10, ankr: 500, quicknode: 30, infura: 160 },
  getProgramAccountsV2: { alchemy: null, helius: 1, ankr: null, quicknode: null, infura: null },
  sendTransaction: { alchemy: 20, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getTransaction: { alchemy: 40, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getBlock: { alchemy: 40, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getSignaturesForAddress: { alchemy: 40, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getSupply: { alchemy: 160, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  getLargestAccounts: { alchemy: 3000, helius: 1, ankr: 500, quicknode: 30, infura: 160 },
  // DAS is a Metaplex standard; Helius and QuickNode price it above plain RPC.
  'DAS:*': { alchemy: null, helius: 10, ankr: null, quicknode: 60, infura: 160 },
}

/**
 * Alchemy bills some methods at one rate but throttles them at another.
 * getProgramAccounts bills 20 CU yet consumes 117 throughput CU — it eats
 * your rate limit ~6x harder than it eats your quota.
 */
export const ALCHEMY_THROUGHPUT_CU = {
  getProgramAccounts: { billed: 20, throughput: 117 },
  getSupply: { billed: 160, throughput: 800 },
  eth_chainId: { billed: 0, throughput: 5 },
}

/**
 * Cost of N calls to `method`, given a strategy.
 *   strategy 'serial'    — N separate HTTP requests
 *   strategy 'batch'     — one JSON-RPC array of N (adds envelope where billed)
 *   strategy 'aggregate' — N logical reads collapsed into `calls` real calls
 */
export function costOf({ chain, method, n, provider, strategy = 'serial', calls = null }) {
  const table = chain === 'solana' ? SOLANA_COSTS : EVM_COSTS
  const unit = table[method]?.[provider]
  if (unit == null) return null

  if (strategy === 'aggregate') return unit * (calls ?? 1)
  if (strategy === 'batch') {
    const surcharge = BATCH_BILLING[provider]?.envelopeSurcharge ?? 0
    return unit * n + unit * surcharge
  }
  return unit * n
}

export function providersFor(chain) {
  return Object.entries(PROVIDERS)
    .filter(([, p]) => p.chains.includes(chain))
    .map(([k]) => k)
}
