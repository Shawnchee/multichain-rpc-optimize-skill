# Cost Model

The provider rate data behind every number in this repo: where it comes from,
the rules it follows, and how to refresh it.

Machine-readable source of truth:
[`skills/rpc-optimize/benchmarks/lib/cost-model.mjs`](../skills/rpc-optimize/benchmarks/lib/cost-model.mjs).
Prose version for the agent:
[`references/providers.md`](../skills/rpc-optimize/references/providers.md).

- [Verification policy](#verification-policy)
- [Structure](#structure)
- [Metering models](#metering-models)
- [Batch billing](#batch-billing-the-central-claim)
- [Recorded contradictions](#recorded-contradictions)
- [Refreshing the data](#refreshing-the-data)

## Verification policy

Four rules, in priority order.

**1. Primary sources only.** Provider documentation, or library source when
documenting library behaviour. Blog posts, search-result summaries, and
recollection are not acceptable — several widely-repeated figures are wrong (see
[Recorded contradictions](#recorded-contradictions)).

**2. An absent number beats a remembered one.** Where a provider publishes
nothing, the field is `null` and `notes` explains. Consumers must handle absence;
they must never be handed a plausible invention.

**3. Every figure carries a source URL and a verification date.** `VERIFIED_ON`
is exported and printed in every benchmark header, so stale data announces itself.

**4. Contradictions are recorded, not resolved.** When a provider's own pages
disagree, both values are documented and neither is hardcoded. Picking one would
manufacture false confidence.

## Structure

```js
export const VERIFIED_ON = '2026-08-04'

BATCH_BILLING   // per provider: model, envelope surcharge, verbatim quote, source
PROVIDERS       // unit, chains served, rate-limit model, tiers, error billing
EVM_COSTS       // method -> { alchemy, infura, ankr, quicknode }
SOLANA_COSTS    // method -> { alchemy, helius, ankr, quicknode, infura }
ALCHEMY_THROUGHPUT_CU  // methods that bill and throttle at different rates

costOf({ chain, method, n, provider, strategy, calls })
```

`costOf` returns `null` rather than a guess when a provider publishes no rate for
a method. Callers render that as `—`.

The `verified` field on `BATCH_BILLING` is tri-state: `true`, `false`, or a
qualifier such as `'rate-limits-only'` where a provider documents the rule for
throughput but not for billing.

## Metering models

| Provider | Unit | Chains | Rate limit expressed as | Pricing shape |
|---|---|---|---|---|
| Alchemy | Compute Units | EVM + Solana | CU/s, 10s rolling token bucket | Per-method, wide spread (0–3,000) |
| Infura | credits | EVM + Solana | credits/s | Per-method EVM; flat 160 Solana |
| Ankr | credits | EVM + Solana | requests/s | Flat: 200 EVM, 500 Solana |
| QuickNode | credits | EVM + Solana | credits/s (CPS) | Flat per chain: 20 EVM, 30 Solana |
| Helius | credits | Solana only | requests/s, separate buckets | Mostly flat at 1, with 10× and 100× exceptions |

The shape matters more than the absolute numbers. Flat-rate providers (Ankr,
QuickNode) are indifferent to payload size, which is precisely why contract-level
aggregation wins there and transport-level batching cannot.

## Batch billing — the central claim

The repo asserts that JSON-RPC array batching does not reduce cost. Evidence per
provider, at the level it is actually documented:

| Provider | Status | Evidence |
|---|---|---|
| **Alchemy** | Documented | A row in the CU cost table: `batch*` — *"CU of method # times called"* |
| **Infura** | Documented, **N+1** | *"…those 30 requests count against the daily credit request limit, as well as the batch of requests, so this would be 31 total requests."* |
| **Ankr** | Documented | *"every sub-call in a batch is billed and rate-limited individually"* |
| **QuickNode** | Documented for rate limits | *"batching also counts as CPS because each request is counted individually."* Credit billing is implied by their own Multicall guide, not stated. |
| **Helius** | **Not documented** | No batch clause exists on the credits page. |

The Helius case deserves care. The nearest adjacent text is a dashboard-metric
FAQ whose examples are `getAssetBatch` and `getMultipleAccounts` — multi-item
*methods*, not JSON-RPC array batches. Read literally it would contradict the
`getMultipleAccounts` guidance this repo gives. The model therefore marks Helius
`undocumented` and assumes per-method **for modelling only**, with the assumption
stated in the benchmark output.

Corroboration from the other direction: QuickNode's documentation explicitly
steers users *away* from array batching and *toward* Multicall3, with its own
credit table showing 5 `eth_call` at 100 credits versus 1 Multicall at 20.

## Recorded contradictions

Documented rather than resolved, per rule 4.

**Alchemy free-tier throughput.** The pricing-plans table states 1,000 CU/s; the
throughput page's worked example and the CUPS support article both state
500 CU/s. Not resolvable from primary sources. Neither is hardcoded.

**QuickNode Solana large-call multiplier.** The API-credits page describes a 4×
multiplier for `getlargestaccounts` and `getsupply`, but the live credits API
returns 30 (1×) for both. No figure is cited.

**Ankr per-method variation.** Ankr's prose claims methods "have different API
credit values based on usage intensity," but every published table reads
`all methods` at one flat rate. The tables are treated as authoritative and the
prose noted as unsupported.

**Stale figures in circulation.** QuickNode `eth_call = 80` and
`eth_getLogs = 255` appear widely in search results and are wrong — the live API
returns 20 for both. The 255 figure is Infura's `eth_getLogs` price, conflated.
Anything reproducing these numbers has not checked a primary source.

## Non-obvious rate behaviour

**Billed cost ≠ throughput cost on Alchemy.** Some methods consume rate limit at
a different rate than they consume quota:

| Method | Billed CU | Throughput CU |
|---|---:|---:|
| `getProgramAccounts` | 20 | **117** |
| `getSupply` | 160 | 800 |
| `eth_chainId` | 0 | 5 |

A workload sized against the billed figure will hit 429s unexpectedly.

**Error billing differs by provider.** Alchemy charges full CU for non-rate-limit
4xx/5xx; QuickNode bills no 4xx/5xx at all; Ankr charges regardless of node
success except on 429. A retry loop against a persistent error costs real money
on Alchemy and nothing on QuickNode.

**Subscriptions are not free.** Alchemy bills WebSockets and webhooks at
0.04 CU/byte. This directly qualifies the standard "replace polling with
subscriptions" advice — on Alchemy it must be priced, not assumed.

## Refreshing the data

1. Re-read each provider's cost page. Links are collected at the bottom of
   [`providers.md`](../skills/rpc-optimize/references/providers.md).
2. Update `cost-model.mjs`, including `VERIFIED_ON`.
3. Mirror any change into `providers.md`. The two must not drift — the JS drives
   the benchmarks, the Markdown drives the agent.
4. Re-run `npm run bench` and commit the regenerated `RESULTS.md`.
5. If a provider newly documents something previously `null`, remove the `notes`
   caveat in the same commit so stale hedging does not accumulate.

### Adding a provider

Add an entry to `PROVIDERS`, a column to `EVM_COSTS` and/or `SOLANA_COSTS`, and a
`BATCH_BILLING` record. Then extend the `provs` array in the relevant
`bench-*.mjs`. Any method the provider does not publish stays `null` — do not
interpolate from a neighbouring tier or a similar method.
