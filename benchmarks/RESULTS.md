# Benchmark Results

Measured 2026-08-03 16:32 UTC against **public, unauthenticated endpoints**.
Latency will differ on a paid endpoint; the **cost columns are provider-published rates**
and are independent of which endpoint the timings came from.

Reproduce: `node benchmarks/bench-evm.mjs` and `node benchmarks/bench-solana.mjs`.

## EVM — 50 ERC-20 balance reads

```

EVM balance-read benchmark
  endpoint : https://ethereum-rpc.publicnode.com
  token    : USDC
  reads    : 50   runs: 3 (median reported)
  cost data verified 2026-08-04

  correctness baseline: 7/50 holders with non-zero balance

  serial (50 HTTP, 50 eth_call)                 889 ms   results match ✓
  JSON-RPC batch (1 HTTP, 50 eth_call)          165 ms   results match ✓
  Multicall3 (1 HTTP, 1 eth_call)               290 ms   results match ✓

  Latency
    serial          889 ms  (1.0x faster than slowest)
    batch           165 ms  (5.4x faster than slowest)
    multicall3      290 ms  (3.1x faster than slowest)

  Billable cost for 50 reads
                      alchemy      infura        ankr   quicknode
    serial              1,300       4,000      10,000       1,000
    batch               1,300       4,080      10,000       1,000
    multicall3             26          80         200          20
                         (CU)   (credits)   (credits)   (credits)

  Savings, multicall3 vs serial
    alchemy          1,300 ->      26 CU       50x cheaper
    infura           4,000 ->      80 credits  50x cheaper
    ankr            10,000 ->     200 credits  50x cheaper
    quicknode        1,000 ->      20 credits  50x cheaper

  Batching vs serial (the point most people get wrong)
    alchemy          1,300 CU       identical to serial
    infura           4,080 credits  80 MORE than serial
    ankr            10,000 credits  identical to serial
    quicknode        1,000 credits  identical to serial

  Infura bills the batch envelope as an extra request:
    "All requests in the array are counted as individual requests against the daily credit limit and ..."

```

## Solana — 40 account reads

```

Solana account-read benchmark
  endpoint : https://api.mainnet-beta.solana.com
  reads    : 40   runs: 3 (median reported)
  cost data verified 2026-08-04

  correctness baseline: 16/40 accounts exist on-chain

  serial (40 HTTP, 40 getAccountInfo)          15,730 ms   results match ✓  [66 rate-limit retries — timing inflated]
  JSON-RPC batch (4 HTTP, 40 calls)            unavailable — HTTP 429: [ {"jsonrpc":"2.0","error":{"code": 429,"message
                                               (public mainnet-beta blocks batched getAccountInfo; use a keyed endpoint)
  getMultipleAccounts (1 HTTP/call)               404 ms   results match ✓

  Latency
    serial     15,730 ms  (1.0x faster than slowest)  ← throttled by public endpoint, not a clean latency number
    gMA           404 ms  (38.9x faster than slowest)

  Billable cost for 40 account reads
                   alchemy     helius       ankr  quicknode     infura
    serial             400         40     20,000      1,200      6,400
    gMA                 20          1        500         30        160
                      (CU)  (credits)  (credits)  (credits)  (credits)

  Savings, getMultipleAccounts vs serial
    alchemy          400 ->     20 CU       20x cheaper
    helius            40 ->      1 credits  40x cheaper
    ankr          20,000 ->    500 credits  40x cheaper
    quicknode      1,200 ->     30 credits  40x cheaper
    infura         6,400 ->    160 credits  40x cheaper

  NOTE: Helius does not document how it bills JSON-RPC array batches.
        Helius documents NO batching discount and NO per-element batch billing rule. Do not claim either. Assumed per-method here for modelling only.

  Payload size levers (same billable cost, very different byte counts)
    base64, full data             142,073 bytes  (1.00x baseline)
    jsonParsed, full data         142,594 bytes  (1.00x baseline)
    base64 + dataSlice(0,32)        1,729 bytes  (0.01x baseline)
    dataSlice is unavailable with jsonParsed encoding.

```
