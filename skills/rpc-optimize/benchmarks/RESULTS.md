# Benchmark Results

| | |
|---|---|
| Measured | 2026-08-03 17:14 UTC |
| EVM endpoint | `ethereum-rpc.publicnode.com` (public, unauthenticated) |
| Solana endpoint | `solana-rpc.publicnode.com` (public, unauthenticated) |
| Node | v25.9.0 |
| Reproduce | `npm run bench` |

Latency depends on the endpoint. **Cost columns are provider-published rates**
and hold regardless of where the timings were taken.

> **On the Solana figures.** Public endpoints cap `getMultipleAccounts` below the
> protocol maximum of 100 — this run probed a cap of 10, so 60 reads became 6 calls
> rather than 1. The saving shown is therefore ~10x; on a keyed endpoint allowing
> the full 100 it is ~60x. The benchmark prints whatever cap it detects.

## EVM — 200 ERC-20 balance reads

```

EVM balance-read benchmark
  endpoint : https://ethereum-rpc.publicnode.com
  token    : USDC
  reads    : 200   runs: 3 (median reported)
  cost data verified 2026-08-04

  correctness baseline: 7/200 holders with non-zero balance

  serial (200 HTTP, 200 eth_call)             3,508 ms   results match ✓
  JSON-RPC batch (1 HTTP, 200 eth_call)         349 ms   results match ✓
  Multicall3 (1 HTTP, 1 eth_call)               166 ms   results match ✓

  Latency
    serial        3,508 ms  (1.0x faster than slowest)
    batch           349 ms  (10.1x faster than slowest)
    multicall3      166 ms  (21.2x faster than slowest)

  Billable cost for 200 reads
                      alchemy      infura        ankr   quicknode
    serial              5,200      16,000      40,000       4,000
    batch               5,200      16,080      40,000       4,000
    multicall3             26          80         200          20
                         (CU)   (credits)   (credits)   (credits)

  Savings, multicall3 vs serial
    alchemy          5,200 ->      26 CU       200x cheaper
    infura          16,000 ->      80 credits  200x cheaper
    ankr            40,000 ->     200 credits  200x cheaper
    quicknode        4,000 ->      20 credits  200x cheaper

  Batching vs serial (the point most people get wrong)
    alchemy          5,200 CU       identical to serial
    infura          16,080 credits  80 MORE than serial
    ankr            40,000 credits  identical to serial
    quicknode        4,000 credits  identical to serial

  Infura bills the batch envelope as an extra request:
    "All requests in the array are counted as individual requests against the daily credit limit and ..."

```

## Solana — 60 account reads

```

Solana account-read benchmark
  endpoint : https://solana-rpc.publicnode.com
  reads    : 60   runs: 3 (median reported)
  cost data verified 2026-08-04

  endpoint getMultipleAccounts cap: 10  (below the protocol max of 100)
  correctness baseline: 16/60 accounts exist on-chain

  serial (60 HTTP, 60 getAccountInfo)           3,818 ms   results match ✓
  JSON-RPC batch (6 HTTP, 60 calls)             1,426 ms   results match ✓
  getMultipleAccounts (6 HTTP/call)             1,394 ms   results match ✓

  Latency
    serial      3,818 ms  (1.0x faster than slowest)
    batch       1,426 ms  (2.7x faster than slowest)
    gMA         1,394 ms  (2.7x faster than slowest)

  Billable cost for 60 account reads
                   alchemy     helius       ankr  quicknode     infura
    serial             600         60     30,000      1,800      9,600
    batch              600         60     30,000      1,800      9,760
    gMA                120          6      3,000        180        960
                      (CU)  (credits)  (credits)  (credits)  (credits)

  Savings, getMultipleAccounts vs serial
    alchemy          600 ->    120 CU       5x cheaper
    helius            60 ->      6 credits  10x cheaper
    ankr          30,000 ->  3,000 credits  10x cheaper
    quicknode      1,800 ->    180 credits  10x cheaper
    infura         9,600 ->    960 credits  10x cheaper

  NOTE: Helius does not document how it bills JSON-RPC array batches.
        Helius documents NO batching discount and NO per-element batch billing rule. Do not claim either. Assumed per-method here for modelling only.

  Payload size levers (same billable cost, very different byte counts)
    base64, full data             142,073 bytes  (1.00x baseline)
    jsonParsed, full data         142,594 bytes  (1.00x baseline)
    base64 + dataSlice(0,32)        1,729 bytes  (0.01x baseline)
    dataSlice is unavailable with jsonParsed encoding.

```
