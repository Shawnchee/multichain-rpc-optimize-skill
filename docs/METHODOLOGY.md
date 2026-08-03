# Benchmark Methodology

How the harness measures, what it deliberately does not claim, and how to read
the output without drawing a wrong conclusion.

- [Design goals](#design-goals)
- [What is measured](#what-is-measured)
- [Correctness gate](#correctness-gate)
- [Confounders the harness controls for](#confounders-the-harness-controls-for)
- [Reading the output](#reading-the-output)
- [Adding a benchmark](#adding-a-benchmark)

## Design goals

1. **Zero dependencies.** The harness uses only Node built-ins, including
   hand-rolled ABI encoding. A benchmark that requires `npm install` is a
   benchmark that does not get run — and bundling `viem` would mean measuring
   viem rather than the underlying strategies.
2. **Cost and latency reported separately.** Conflating them is the specific
   confusion the parent skill exists to correct. Batching improves latency and
   not cost; aggregation improves both. They get different columns.
3. **Correctness is a gate, not a footnote.** A strategy that returns different
   data fails the run.
4. **Never present a throttled measurement as a clean one.** Rate limiting is
   detected, counted, and disclosed.

## What is measured

Each benchmark performs the same logical work three ways:

| Strategy | HTTP requests | Billable methods |
|---|---|---|
| `serial` | N | N |
| `batch` (JSON-RPC array) | ⌈N / chunk⌉ | N — **N+1 on Infura** |
| `aggregate` (Multicall3 / `getMultipleAccounts`) | ⌈N / cap⌉ | ⌈N / cap⌉ |

**Latency** is wall-clock, median of `--runs` repetitions. Single samples against
public endpoints are noise.

**Cost is computed, not timed.** It comes from
[`lib/cost-model.mjs`](../skills/rpc-optimize/benchmarks/lib/cost-model.mjs),
which holds provider-published per-method rates. This is deliberate: cost is a
property of the provider's price list, not of the endpoint you measured latency
against. It means the cost columns are valid even though the timings came from
free public endpoints.

`lib/rpc.mjs` counts HTTP round-trips and billable method invocations as separate
counters, because that distinction is the entire point.

## Correctness gate

Every benchmark computes a baseline, then compares each strategy against it
element-by-element:

```
serial (200 HTTP, 200 eth_call)      3,501 ms   results match ✓
JSON-RPC batch (1 HTTP, 200 calls)     342 ms   results match ✓
Multicall3 (1 HTTP, 1 eth_call)        166 ms   results match ✓
```

A `MISMATCH ✗` invalidates the run. This is not ceremonial — hand-rolled
`aggregate3` encoding is exactly the kind of code that returns plausible garbage
when the offset arithmetic is wrong, and the reported saving would look identical.

The EVM benchmark additionally reports how many holders had a non-zero balance,
so a run cannot pass by comparing a wall of zeros to a wall of zeros.

## Confounders the harness controls for

**Rate limiting.** Public endpoints throttle aggressively. `lib/rpc.mjs` backs
off exponentially on 429, counts the retries, and annotates any timing they
touched:

```
serial (40 HTTP, 40 getAccountInfo)  15,730 ms  ✓  [66 rate-limit retries — timing inflated]
```

Without this, `serial` would appear ~10× slower than it is and overstate the
optimization. Such numbers describe what throttling feels like, not network
latency.

**Endpoint-specific caps.** The protocol maximum for `getMultipleAccounts` is
100, but endpoints enforce lower limits and report them as opaque errors — public
`publicnode` caps at 10. The Solana benchmark **binary-searches the real cap**,
prints it, and chunks accordingly:

```
endpoint getMultipleAccounts cap: 10  (below the protocol max of 100)
```

A hardcoded 100 caused an outright failure on such endpoints, which is why an
earlier committed run had no batch row at all.

**Cold caches and warm paths.** The baseline runs before timing begins, so the
first strategy is not penalised for a cold connection.

**Concurrency.** `serial` uses bounded concurrency (10 on EVM, 3 on Solana)
rather than unbounded `Promise.all`. Unbounded would measure the endpoint's
rate limiter rather than the strategy.

## Reading the output

Three things will mislead you if you skim:

1. **A throttled `serial` number is not a latency measurement.** Check for the
   retry annotation before quoting a speedup.
2. **A capped endpoint understates aggregation.** A run showing 10× on a
   10-key-capped endpoint is ~60× at the protocol maximum. Re-run with `--rpc`
   against a keyed endpoint before quoting a figure to anyone.
3. **Aggregation is not always the latency winner.** In the 60-read Solana run,
   `getMultipleAccounts` was marginally slower than batching (1,406 ms vs
   1,248 ms) while being 10× cheaper. Report the cost win on its own merits.

## Known limitations

- **Public endpoints only, by default.** Latency figures are indicative. Cost
  figures are not affected.
- **Public Solana mainnet-beta blocks batched `getAccountInfo` outright**, so the
  batch row is unavailable there. The default endpoint was changed to
  `publicnode` specifically so all three strategies complete.
- **Zero-balance holders.** Beyond the curated real-holder list, addresses are
  derived deterministically and hold nothing. `balanceOf` still performs a full
  `SLOAD`, so per-call work is representative, but this is a synthetic tail.
- **No write-path benchmarks.** Everything measured is a read. Transaction
  submission has different cost and failure characteristics.
- **Single region.** All measurements come from one machine. Cross-region
  latency is not characterised.

## Adding a benchmark

1. Write the naive and optimized paths as two async functions returning
   comparable output.
2. Compute a baseline and assert equality. **No correctness check, no benchmark.**
3. Use `repeat(RUNS, fn)` for a median.
4. Report billable method counts separately from HTTP request counts.
5. If the strategy has an endpoint-dependent limit, probe it rather than
   hardcoding — see `probeGmaCap()` in `bench-solana.mjs`.
6. If you bound coverage in any way, print what was skipped. Silent truncation
   reads as full coverage.
