# Measuring Before and After

Don't propose an optimization without a number. The repo ships a dependency-free
harness — Node 18+, no install step.

```bash
node benchmarks/bench-evm.mjs     --n 50 --runs 3
node benchmarks/bench-solana.mjs  --n 40 --runs 3

# against the user's own endpoint (recommended — public endpoints throttle)
node benchmarks/bench-evm.mjs    --rpc "$ALCHEMY_URL" --n 200
node benchmarks/bench-solana.mjs --rpc "$HELIUS_URL"  --n 500
```

Committed output: `benchmarks/RESULTS.md`.

## What the harness measures

Each benchmark runs the same logical work three ways and **cross-checks the
results against a baseline** — a strategy that returns different data fails the
run. A fast wrong answer is not an optimization.

| Strategy | HTTP requests | Billable methods |
|---|---|---|
| serial | N | N |
| JSON-RPC batch | ⌈N/chunk⌉ | N (N+1 on Infura) |
| aggregate (Multicall3 / `getMultipleAccounts`) | ⌈N/limit⌉ | ⌈N/limit⌉ |

Cost columns come from `benchmarks/lib/cost-model.mjs`, which holds
provider-published rates with source URLs. Cost is computed, not timed — it's
independent of which endpoint you measure latency on.

## Reading the output honestly

Three things will mislead you if you don't watch for them:

1. **Rate-limit retries inflate latency.** The harness counts 429 retries and
   labels any timing they affected. A `serial` run showing 15s against public
   mainnet-beta is measuring the rate limiter, not the network. Cite those
   numbers as "what throttling feels like", never as clean latency.
2. **Public endpoints have their own caps.** `solana-rpc.publicnode.com` rejects
   `getMultipleAccounts` arrays in the low teens; public mainnet-beta blocks
   batched `getAccountInfo` outright. Neither reflects a keyed endpoint.
3. **Latency and cost are different wins.** Batching improves latency and does
   nothing for cost. Aggregation improves both. Report them in separate columns —
   conflating them is exactly the confusion this skill exists to fix.

## Adding a benchmark

`bench-*.mjs` files use only `lib/rpc.mjs` (timed client with request accounting
and backoff), `lib/abi.mjs` (hand-rolled encoding, no deps), and
`lib/cost-model.mjs`. To add a case:

1. Write the naive and optimized versions as two async functions returning
   comparable output.
2. Compute a baseline and assert equality — no correctness check, no benchmark.
3. Use `repeat(RUNS, fn)` for a median; single samples on public endpoints are noise.
4. Report billable method counts separately from HTTP request counts.

## Sanity numbers

Measured 2026-08-04 on public endpoints (see `RESULTS.md`):

- 50 EVM balance reads: Multicall3 is **50× cheaper** than serial on every
  provider, and the JSON-RPC batch costs the same as serial (more on Infura).
- 40 Solana account reads: `getMultipleAccounts` is **20–40× cheaper**.
- `dataSlice(0,32)` cut an 8-account response from **142,073 → 1,729 bytes**
  at identical billable cost.

If a user's own numbers differ by more than ~2×, check for a per-method rate
class (Alchemy's throughput CU) or a flat-rate provider (Ankr, QuickNode) before
assuming the harness is wrong.
