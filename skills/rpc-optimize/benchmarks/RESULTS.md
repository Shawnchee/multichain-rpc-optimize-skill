# Benchmark Results

Measured 2026-08-03 16:44 UTC against **public, unauthenticated endpoints**.
Latency differs on a paid endpoint; the **cost columns are provider-published rates**
and are independent of which endpoint produced the timings.

Reproduce: `npm run bench` (Node 18+, no install step).

> Public endpoints impose their own caps. The Solana run below probed a
> `getMultipleAccounts` limit of 10, well under the protocol max of 100 — so the
> aggregation saving shown is ~10x. On a keyed endpoint allowing the full 100,
> the same 40 reads collapse to a single call and the saving is ~40x.

## EVM — 50 ERC-20 balance reads

```

EVM balance-read benchmark
  endpoint : https://ethereum-rpc.publicnode.com
  token    : USDC
  reads    : 50   runs: 3 (median reported)
  cost data verified 2026-08-04

  correctness baseline: 7/50 holders with non-zero balance

  serial (50 HTTP, 50 eth_call)                 848 ms   results match ✓
  JSON-RPC batch (1 HTTP, 50 eth_call)          173 ms   results match ✓
  Multicall3 (1 HTTP, 1 eth_call)               163 ms   results match ✓

  Latency
    serial          848 ms  (1.0x faster than slowest)
    batch           173 ms  (4.9x faster than slowest)
    multicall3      163 ms  (5.2x faster than slowest)

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
  endpoint : https://solana-rpc.publicnode.com
  reads    : 40   runs: 3 (median reported)
  cost data verified 2026-08-04

  endpoint getMultipleAccounts cap: 10  (below the protocol max of 100)
  correctness baseline: 16/40 accounts exist on-chain

  serial (40 HTTP, 40 getAccountInfo)           2,622 ms   results match ✓
  JSON-RPC batch (4 HTTP, 40 calls)             1,120 ms   results match ✓
  getMultipleAccounts (4 HTTP/call)               925 ms   results match ✓

  Latency
    serial      2,622 ms  (1.0x faster than slowest)
    batch       1,120 ms  (2.3x faster than slowest)
    gMA           925 ms  (2.8x faster than slowest)

  Billable cost for 40 account reads
                   alchemy     helius       ankr  quicknode     infura
    serial             400         40     20,000      1,200      6,400
    batch              400         40     20,000      1,200      6,560
    gMA                 80          4      2,000        120        640
                      (CU)  (credits)  (credits)  (credits)  (credits)

  Savings, getMultipleAccounts vs serial
    alchemy          400 ->     80 CU       5x cheaper
    helius            40 ->      4 credits  10x cheaper
    ankr          20,000 ->  2,000 credits  10x cheaper
    quicknode      1,200 ->    120 credits  10x cheaper
    infura         6,400 ->    640 credits  10x cheaper

  NOTE: Helius does not document how it bills JSON-RPC array batches.
        Helius documents NO batching discount and NO per-element batch billing rule. Do not claim either. Assumed per-method here for modelling only.

  Payload size levers (same billable cost, very different byte counts)
    base64, full data             142,073 bytes  (1.00x baseline)
    jsonParsed, full data         142,594 bytes  (1.00x baseline)
    base64 + dataSlice(0,32)        1,729 bytes  (0.01x baseline)
    dataSlice is unavailable with jsonParsed encoding.

```
