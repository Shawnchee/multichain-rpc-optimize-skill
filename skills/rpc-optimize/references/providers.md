# Provider Cost & Limit Reference

All figures verified **2026-08-04** against each provider's own documentation.
Pricing changes without notice — re-verify before quoting as current.
Where a provider publishes nothing, this file says so. **An absent number is
safer than a remembered one.**

Machine-readable version: `benchmarks/lib/cost-model.mjs`.

## Metering models at a glance

| Provider | Unit | Chains | Rate limit expressed as | Batch billing |
|---|---|---|---|---|
| Alchemy | Compute Units | EVM + Solana | CU/s (CUPS), 10s rolling token bucket | per method ✅ documented |
| Infura | credits | EVM + Solana | credits/s | per method **+ 1 for the envelope** ✅ |
| Ankr | credits | EVM + Solana | requests/s (never credits/s) | per sub-call ✅ documented |
| QuickNode | credits | EVM + Solana | credits/s (CPS) | per request ✅ for rate limits |
| Helius | credits | Solana only | requests/s, separate RPC/DAS buckets | ❌ **undocumented** |

## The batch-billing quotes

**Alchemy** — a literal row in the CU cost table:
> `batch*` | **CU of method # times called**

**Infura** — the strongest evidence anywhere that batching is not an optimization:
> "All requests in the array are counted as individual requests against the daily credit limit **and batch itself is counted as a request**. For example, if the array contains 30 requests, then those 30 requests count against the daily credit request limit, as well as the batch of requests, so this would be **31 total requests**."

**Ankr**:
> "every sub-call in a batch is billed and rate-limited individually"

**QuickNode** (rate limits; credit billing implied by its own Multicall guide):
> "Remember that batching also counts as CPS because each request is counted individually."

**Helius** — **no batch clause exists** on the credits page. The only adjacent
text is a dashboard-metric FAQ whose examples are `getAssetBatch` and
`getMultipleAccounts` — multi-item *methods*, not JSON-RPC array batches. Read
literally it would contradict the `getMultipleAccounts` advice. **Do not claim
Helius bills per element in a batch; say it is undocumented.**

## Alchemy

**EVM (CU):** `eth_chainId` 0 · `eth_blockNumber` 10 · `eth_getBalance` /
`eth_getBlockByNumber` / `eth_getCode` / `eth_getStorageAt` /
`eth_getTransactionReceipt` / `eth_estimateGas` 20 · **`eth_call` 26** ·
`eth_sendRawTransaction` 40 · `eth_getLogs` 60 · `txpool_content` 500

**Solana (CU):** `getAccountInfo` / `getBalance` / `getTokenAccountsByOwner` 10 ·
`getMultipleAccounts` / `getProgramAccounts` / `getLatestBlockhash` /
`getSignatureStatuses` / `sendTransaction` 20 · `getTransaction` / `getBlock` /
`getSignaturesForAddress` 40 · `getTransactionsForAddress` 100 · `getSupply` 160 ·
**`getLargestAccounts` 3,000**

**Billed vs throughput CU diverge on some methods:**

| Method | Billed | Throughput |
|---|---|---|
| `getProgramAccounts` | 20 | **117** |
| `getSupply` | 160 | 800 |
| `eth_chainId` | 0 | 5 |

**Tiers:** Free 30M CU/mo; PAYG $0.45/M CU up to 300M, $0.40/M above.
⚠️ Alchemy's docs **contradict themselves** on free-tier throughput: the
pricing-plans table says 1,000 CU/s, the throughput page example says 500 CU/s.
Don't hardcode either. There is no documented "Scale"/"Growth" tier.

**Error billing:** 429 and 403 cost 0. **Other 4xx/5xx still cost full CU.**

**Batching:** 1,000/batch over HTTP, **20 over WebSocket**; best-practices says
aim under 50. Unsupported on Transfers, Transact, Token, Trace, Debug APIs.

**Subscriptions/webhooks: 0.04 CU/byte** (~40 CU per typical 1 KB event); Base
Flashblocks priced per event (40–60 CU). **Migrating from polling to WebSocket is
not automatically cheaper on Alchemy.**

**Caching: not documented.** No Alchemy page states repeated identical requests
are cached or free. Don't assert it.

## Infura

**EVM (credits):** `eth_chainId` / `net_version` / `eth_subscribe` **5** ·
`eth_call` / `eth_getBalance` / `eth_getBlockByNumber` /
`eth_getTransactionReceipt` / `eth_blockNumber` / `eth_getCode` /
`eth_sendRawTransaction` **80** · `eth_estimateGas` / `trace_*` 300 ·
**`eth_getLogs` 255** · `eth_getBlockReceipts` / `debug_*` **1,000**

**Solana: flat 160 credits, all methods.** No per-method breakdown exists.

**Tiers:** Free 3M/day @ 500 credits/s · Developer 15M @ 4,000/s · Team 75M @
40,000/s. Resets 00:00 UTC. **No method costs 0** — the floor is 5.

**Errors:** 429 and 402 not charged.

**`eth_getLogs`: no block-range cap.** Instead: 10,000 max results, 5,000 max
params, 10s timeout — all `-32005`. A 1-block range can still fail on results.

**Max batch size: not documented.** Don't publish a number.

⚠️ **Naming trap:** Infura's docs say batching "is also commonly referred to as
'multi-call'." That is the opposite of Multicall3. Someone asking for "multicall
on Infura" following their docs will implement the N+1 option.

Infura's own cost advice: cache locally, limit startup RPC calls, "Don't poll
Infura in a tight loop… consider using `eth_subscribe`."

## Ankr

**Flat rate, all methods:** EVM **200** · Solana **500** · Beacon 700 ·
Advanced API 700 · other non-EVM 200. `0.10 USD = 1M credits`.

⚠️ Ankr's prose claims methods "have different API credit values," but **every
published table says `all methods` at one flat rate.** No per-method table
exists. Don't infer per-method Ankr pricing.

**Tiers:** Public (no key, ~1,800 req/min across all endpoints) · Freemium
(200M credits/mo, same throughput) · Premium (~1.5k req/s EVM, ~4k req/s Solana,
*per endpoint*). Freemium's 200M ÷ 200 = 1M EVM requests/month.

**Batch caps:** 10 (public) / 100 (freemium) / **1,000 (premium)**. Advanced API
25. Over-size → `-32062`.

**`eth_getLogs` block range:** 1,000 / 3,000 / 10,000 by tier. Polygon
temporarily 100 / 1,000 / 1,000. Over-range → `-32062`.

**WSS:** EVM 200/subscription + 100/notification; Solana 500 + 500.

**Errors:** 429 not charged; otherwise charged regardless of node success.
Overdraft to −$5, then keys return 401/403.

⚠️ **Ankr Solana nodes retain only ~16 hours of history.** Historical methods
return null/error beyond that.

**Multicall3: not documented.** Zero mentions across Ankr's 10 MB doc corpus as a
cost strategy. Their only guidance is "batch requests or upgrade your plan."

## QuickNode

**Flat rate per chain:** Ethereum (+ Arbitrum, Base, Optimism, Polygon, BNB,
Linea…) **20 credits/method**. Solana (+ Monad, Scroll, Tron, zkSync…) **30**.
Bitcoin/Aptos/Flow tier 10; Celo/Cosmos/Sui/TON/XRP 40; NEAR & Polygon zkEVM 50.

Multipliers: **Advanced APIs 2×** (trace/debug, Token/NFT API, Solana `getAsset*`
→ 40 EVM / 60 Solana). **Large Calls 4×** (`txpool_content`, `trace_replay*` → 80).

⚠️ **Stale numbers warning:** `eth_call = 80` and `eth_getLogs = 255` circulate
widely in search results. Those are **wrong**; QuickNode's live credits API
returns **20** for both. (255 is Infura's `eth_getLogs` price — the two get conflated.)

⚠️ QuickNode's page claims a 4× multiplier for Solana `getlargestaccounts` and
`getsupply`, but its credits API returns 30 for both. Contradictory — cite no number.

**Rate limits:** credits/second (CPS). Per-tier numbers are behind JS on the
pricing page and are **not documented here**.

**`eth_getLogs` block range:** 5 (free trial) / 10,000 (paid).

**Errors:** 4xx and 5xx are **not** billed.

**QuickNode explicitly recommends Multicall3 and discourages JSON-RPC batching:**
> "Consider the cost of making five separate `eth_call` requests compared to a single Multicall request… Separate `eth_call` requests: 5 calls = 100 credits. Multicall: 1 call = 20 credits."
> "Instead of direct batch requests, consider the following alternative methods…"

## Helius (Solana only)

| Credits | What |
|---|---|
| 1 | standard RPC, `getProgramAccountsV2`, `simulateBundle`, Priority Fee API, most historical queries, webhook event delivered |
| **10** | **`getProgramAccounts`**, all DAS methods, `getTransfersByAddress` |
| 10+ | `getTransactionsForAddress` (10 per 100 txs; 10 flat for signatures-only) |
| **100** | Enhanced transaction parsing, webhook create/edit/delete |
| 2 / 0.1 MB | LaserStream WSS & gRPC, Shred Delivery |
| 10 / message | Preconfirmations (Professional) |
| 0 | Raw Shreds UDP ($1,000/mo/IP seat) |

**Rate limits (separate buckets):**

| Plan | RPC | DAS & Enhanced | `sendTransaction` | `getProgramAccounts` | Credits/mo |
|---|---|---|---|---|---|
| Free | 10/s | 2/s | 1/s | 5/s | 1M |
| Developer | 50/s | 10/s | 5/s | 25/s | 10M |
| Business | 200/s | 50/s | 50/s | 50/s | 100M |
| Professional | 500/s | 100/s | 100/s | 75/s | 200M |

Credits **do not roll over.** WS connection caps: 5 / 150 / 250 / 1,000.

**Batch caps:** `getTransaction` 100 items; `getTransactionsForAddress` and
`getTransfersByAddress` allow **no batching**; other historical methods 10 items.

**Two documented 10× levers:**
1. `getProgramAccountsV2` (1) vs `getProgramAccounts` (10) — a one-line change.
2. Raw `getTransaction` (1) vs Enhanced parsing (100) — parse yourself if you
   only need a few instruction types. Worth it for indexers, not for a dashboard
   showing 20 txs.

Helius's own optimization checklist: `dataSlice`, server-side `memcmp`/`dataSize`
filters, batch to reduce round trips, cache results, close WS subscriptions.
Its documented anti-patterns: polling instead of subscriptions, fetching full
account data when partial suffices, ignoring rate limits, using `finalized` where
`confirmed` suffices.

## Estimating spend

```
daily = Σ call-sites (calls/session × sessions/day × unit_cost)
      + Σ pollers   (86400 / interval_s × unit_cost × watched_items)
```

Pollers usually dominate by an order of magnitude and are usually the term people
forget. Worked example — 10 token balances polled every 2s on Alchemy EVM:

| Approach | CU/day |
|---|---|
| naive | 11,232,000 |
| Multicall3 | 1,123,200 (10×) |
| Multicall3 + 15s interval | 149,760 (75×) |
| WS subscription | bandwidth-billed at 0.04 CU/byte — **compute, don't assume** |

The interval change is free and beats the multicall. **Check polling intervals
before writing any code.**

## Sources

Alchemy [CU costs](https://www.alchemy.com/docs/reference/compute-unit-costs) ·
[throughput](https://www.alchemy.com/docs/reference/throughput) ·
[pricing](https://www.alchemy.com/docs/reference/pricing-plans) ·
[batch](https://www.alchemy.com/docs/reference/batch-requests) ·
[getLogs](https://www.alchemy.com/docs/reference/eth-getlogs) —
Infura [credit costs](https://docs.infura.io/get-started/pricing/credit-cost/) ·
[batch](https://docs.infura.io/how-to/make-batch-requests/) ·
[rate limiting](https://docs.infura.io/how-to/avoid-rate-limiting/) —
Ankr [pricing](https://www.ankr.com/docs/rpc-service/pricing/) ·
[plans](https://www.ankr.com/docs/rpc-service/service-plans/) ·
[quirks](https://www.ankr.com/docs/rpc-service/errors/per-chain-quirks/) —
QuickNode [API credits](https://www.quicknode.com/api-credits) ·
[Multicall guide](https://www.quicknode.com/guides/ethereum-development/transactions/how-to-optimize-ethereum-rpc-usage-with-multicall) ·
[efficient RPC](https://www.quicknode.com/guides/quicknode-products/apis/guide-to-efficient-rpc-requests) —
Helius [credits](https://www.helius.dev/docs/billing/credits) ·
[rate limits](https://www.helius.dev/docs/billing/rate-limits) ·
[optimization](https://www.helius.dev/docs/rpc/optimization-techniques) —
[Multicall3](https://multicall3.com)
