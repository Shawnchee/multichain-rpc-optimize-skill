---
name: rpc-optimize
description: Cut JSON-RPC usage and provider costs for EVM and Solana apps — Multicall3, getMultipleAccounts, aggregation vs batching, caching, WebSocket/webhook migration, and per-method cost accounting for Alchemy, Infura, Ankr, QuickNode, and Helius. Use when the user says "too many RPC calls", "hitting rate limits", "hitting my daily limit", "reduce RPC costs", "compute units", "credit usage", "Alchemy limit", "Infura credits", "Helius credits", "429 errors", "multicall", "batch RPC", "getMultipleAccounts", "getProgramAccounts is slow", "optimize my indexer", "my dApp is slow to load", or when reviewing/writing any code that reads onchain state in a loop. Use proactively whenever generating code that calls an RPC provider more than once.
---

# RPC Optimization

## The one thing most people get wrong

**JSON-RPC batching does not save you money.** It merges HTTP round-trips. Every
provider that documents the rule bills each method *inside* the batch:

- **Alchemy**: `batch* | CU of method # times called`
- **Ankr**: "every sub-call in a batch is billed and rate-limited individually"
- **QuickNode**: "batching also counts as CPS because each request is counted individually"
- **Infura**: bills the batch **N+1** — "if the array contains 30 requests… this
  would be 31 total requests." Batching on Infura is *strictly worse than serial.*
- **Helius**: documents no batch rule at all. Do not claim one either way.

What saves money is **aggregation** — collapsing N logical reads into 1 billable
method call. Computed from the published rates (`benchmarks/lib/cost-model.mjs`,
verified 2026-08-04); the bundled harness reproduces these ratios live — see
`benchmarks/RESULTS.md`:

| 50 EVM balance reads | Alchemy | Infura | Ankr | QuickNode |
|---|---|---|---|---|
| serial (50 × `eth_call`) | 1,300 CU | 4,000 | 10,000 | 1,000 |
| JSON-RPC batch | 1,300 CU | **4,080** | 10,000 | 1,000 |
| **Multicall3 (1 × `eth_call`)** | **26 CU** | **80** | **200** | **20** |

| 40 Solana account reads | Alchemy | Helius | Ankr | QuickNode | Infura |
|---|---|---|---|---|---|
| serial (40 × `getAccountInfo`) | 400 CU | 40 | 20,000 | 1,200 | 6,400 |
| **`getMultipleAccounts` (1 call)** | **20 CU** | **1** | **500** | **30** | **160** |

50× and 40× respectively (20× on Alchemy for Solana). Batching moves neither number.

> ⚠️ **Infura's docs call JSON-RPC batching "multi-call."** That is *not*
> Multicall3. On Infura, "multi-call" is the thing that costs N+1 credits;
> `aggregate3` is the thing that costs 80. Don't let the naming collision
> route someone to the expensive option.

## Two different budgets — don't conflate them

1. **Provider budget** — credits / CU / rate limits. Fixed by how many *billable
   methods* you invoke. Aggregation, caching, and push-instead-of-poll fix this.
2. **Agent context budget** — tokens burned when a coding agent dumps a huge RPC
   response into context. Fixed by `dataSlice`, field projection, and writing
   results to a file. Measured: 8 Solana accounts as full `base64` = 142,073
   bytes; the same read with `dataSlice(0,32)` = **1,729 bytes (99% smaller)**
   for identical billable cost.

If the user says "save tokens", ask which one they mean. Usually it's #1.

## Decision procedure

Stop at the first rule that applies.

1. **Is the data push-able?** Polling every 2s = 43,200 calls/day per watcher.
   Prefer `eth_subscribe` (EVM) or `accountSubscribe`/webhooks (Solana).
   **Check the provider's subscription pricing first** — on Alchemy, WebSockets
   and webhooks bill at **0.04 CU/byte**, so a chatty subscription can cost more
   than the polling it replaced. On Helius a delivered webhook event is 1 credit,
   which beats polling only when event rate < poll rate.

2. **Is it cacheable?** Immutable data — finalized blocks, confirmed txs, ERC-20
   `decimals`/`symbol`/`name`, mint metadata, contract code — fetch once, ever.
   Re-fetching ERC-20 `decimals()` on every render is the most common quota leak
   in dApp frontends. Infura's own advice: "Cache Ethereum data locally."

3. **Are there N reads at one block/slot?** Aggregate:
   - EVM → Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11`
   - Solana accounts → `getMultipleAccounts` (100/call) or Anchor `fetchMultiple`
   - Solana tokens/NFTs → DAS `getAssetsByOwner`, not N × `getAccountInfo`

4. **Is it a scan over many accounts?** Solana `getProgramAccounts` is the trap —
   10 credits on Helius, and on Alchemy it bills 20 CU but consumes **117
   throughput CU**, throttling ~6× harder than it bills. Always filter, always
   `dataSlice`, prefer `getProgramAccountsV2` on Helius (**1 credit vs 10**).
   On EVM prefer `eth_getLogs` with tight ranges over per-item `eth_call` sweeps.

5. **Only now, batch** — for latency, never for cost. Skip entirely on Infura.

6. **Dedupe and coalesce.** Two components asking for the same balance in one
   render should produce one request. A query cache with a sane `staleTime`
   often halves traffic before any protocol work.

## When writing new code

- Never call an RPC method inside a `for`/`map` loop. `await Promise.all(items.map(x => contract.read.foo(...)))` is a multicall waiting to happen.
- Pin an explicit `blockNumber`/`slot` when aggregating — consistent and cacheable.
- Request the narrowest data: `dataSlice`, `base64` over `jsonParsed`, specific log `topics`.
- Put the provider key behind a server route. `NEXT_PUBLIC_*` keys get scraped and drained — a real cause of mystery overage that no batching will fix.

## Diagnosing an existing project

Run `references/audit-patterns.md` — grep patterns for the common waste
signatures plus before/after quota estimation.

## References

**Detect the chain first, then read only that reference.** Check for
`viem`/`ethers`/`wagmi`/`hardhat`/`foundry` (EVM) vs
`@solana/web3.js`/`@coral-xyz/anchor`/`Anchor.toml` (Solana). A provider name
does not imply a chain — Alchemy, Ankr, QuickNode, and Infura all serve both.

- `references/evm.md` — Multicall3, viem/ethers/wagmi (incl. two silent-failure traps), `eth_getLogs` caps
- `references/solana.md` — `getMultipleAccounts`, Anchor, gPA, DAS, subscriptions
- `references/providers.md` — verified per-method costs and limits for all 5 providers
- `references/audit-patterns.md` — grep-based waste audit
- `references/benchmarking.md` — how to measure before/after on your own endpoint

## Honest limits

- Multicall3 is **EVM-only**. No such contract on Solana; the answer there is
  `getMultipleAccounts`. "Multicall for Anchor" is a category error.
- Multicall3 batches reads *at one block*. It can't span blocks or make an
  archive query cheap.
- Aggregation increases response size — good for credits, bad for context.
  Slice fields when an LLM is the consumer.
- All costs verified **2026-08-04** against provider docs. Providers reprice
  without notice; re-verify before quoting as current.
- Where a provider doesn't document something, this skill says so rather than
  guessing. Absent numbers are safer than wrong ones.
