# EVM RPC Optimization

<!-- Verified 2026-08-04 against viem/ethers/wagmi source + provider docs. -->

- [Multicall3](#multicall3)
- [viem](#viem) · [The two silent-failure traps](#the-two-silent-failure-traps)
- [ethers v6](#ethers-v6) · [The hidden `eth_chainId`](#the-hidden-eth_chainid-on-every-call)
- [Dependent reads](#dependent-reads--stage-the-multicall-dont-serialize) · [Sizing](#sizing-a-multicall)
- [eth_getLogs](#eth_getlogs) · [Cache-forever list](#cache-forever-list)

## Multicall3

Canonical address `0xcA11bde05977b3631167028862bE2a173976CA11`, deployed on 250+
chains. ABI and deployment list: https://multicall3.com

N contract reads become **one `eth_call`**.

```solidity
struct Call3 { address target; bool allowFailure; bytes callData; }
struct Result { bool success; bytes returnData; }
function aggregate3(Call3[] calldata calls) public payable returns (Result[] memory);
```

Two caveats from the upstream repo: a few chains that compute addresses
differently have deployments at other addresses, and **Ancient8 has a known-bad
deployment at the canonical address** (the Multicall3 deployer key was
compromised). Verify the address on an unusual chain before trusting it.

### Block-context helpers — all 10

Fold these into the same multicall instead of paying for separate calls:

`getBlockNumber()` · `getCurrentBlockTimestamp()` · `getEthBalance(address)` ·
`getBlockHash(uint256)` · `getLastBlockHash()` · `getChainId()` ·
`getBasefee()` · `getCurrentBlockCoinbase()` · `getCurrentBlockDifficulty()` ·
`getCurrentBlockGasLimit()`

`getEthBalance` is the underused one — it folds native balances into the same
call as your ERC-20 `balanceOf` reads, replacing N × `eth_getBalance` (20 CU
each on Alchemy, 80 credits on Infura, 200 on Ankr).

## viem

### Explicit multicall

```ts
const results = await client.multicall({
  contracts: [
    { address: tokenA, abi: erc20Abi, functionName: 'balanceOf', args: [user] },
    { address: tokenB, abi: erc20Abi, functionName: 'balanceOf', args: [user] },
  ],
  allowFailure: true,       // default
  blockNumber: 21_000_000n, // pin for consistency + cacheability
})
```

**The viem docs misstate the return shape.** The docs page says
`{ data, status: 'reverted' }`. The shipped type (`src/types/multicall.ts`) is:

```ts
{ result: <inferred>, status: 'success' } | { error: Error, status: 'failure' }
```

Use **`result`** not `data`, and **`'failure'`** not `'reverted'`; `error` is an
`Error` object, not a string. With `allowFailure: false` you get a bare array,
but one bad call throws away every result — keep `true` for user-supplied token
lists, where a non-standard token reverting on `symbol()` shouldn't nuke the read.

### Automatic batching — the setting almost nobody turns on

```ts
const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL, {
    batch: { batchSize: 1_000, wait: 16 },   // request COUNT — merges HTTP round-trips only
  }),
  batch: {
    multicall: { batchSize: 1_024, wait: 16 } // calldata BYTES — real aggregation, saves CU
  },
})
```

Note the unit trap: transport `batchSize` counts **requests**; multicall
`batchSize` counts **calldata bytes** (default 1,024; set `0` to disable the cap).

`batch.multicall` is the money option — every `readContract` in the `wait` window
folds into one `aggregate3`. You keep writing normal per-call code.

## The two silent-failure traps

Both degrade to N individual `eth_call`s with **no error thrown**. If you enabled
batching and still see N calls in the dashboard, it's one of these:

**1. viem skips any call carrying extra request fields.** From `src/actions/public/call.ts`:

```
// - The request has no other properties (`nonce`, `gas`, etc cannot be sent with a multicall).
```

Passing `account` (becomes `from`), `value`, `gas`, or `nonce` silently opts that
read out. `simulateContract` therefore generally does not batch. Batches are also
keyed by block tag, so different block tags never share one.

**2. wagmi falls back to N reads on chains without Multicall3.** `readContracts`
catches any non-`ContractFunctionExecutionError` — including the
`ChainDoesNotSupportContract` you get when `chain.contracts.multicall3` is unset —
and quietly retries as individual `readContract` calls. Your "one multicall"
becomes N `eth_call`s and nothing warns you.

wagmi does default `batch: { multicall: true }` in `createConfig` (bare viem does
not), so the fix is usually just configuring `multicall3` on the chain.

## ethers v6

```ts
const mc = new Contract(MULTICALL3, multicall3Abi, provider)
const calls = targets.map(t => ({
  target: t, allowFailure: true,
  callData: erc20.interface.encodeFunctionData('balanceOf', [user]),
}))
const res = await mc.aggregate3.staticCall(calls)
```

**ethers has no built-in Multicall3 support** — zero occurrences in the shipped
package; its README points at the third-party `ext-provider-multicall`.

`JsonRpcApiProvider` options `batchMaxCount` (default 100), `batchMaxSize`
(default 1 MiB), `batchStallTime` (default 10 ms) do **JSON-RPC array batching**,
not aggregation. Set `batchMaxCount: 1` to disable — worth doing on Infura, where
batching costs N+1.

### The hidden `eth_chainId` on every call

By default a `JsonRpcProvider` re-detects the network on every high-level call
(`getBalance`, `call`, `getBlock`, contract reads, …): after the first one,
`AbstractProvider.getNetwork()` runs `_detectNetwork()` (an `eth_chainId`)
alongside each call to assert the chain hasn't changed
(`lib.esm/providers/abstract-provider.js`, ethers 6.17.0). Raw `provider.send()`
skips this. Nothing in your code shows it.

Measured 2026-10-24 on Infura Ethereum mainnet: 5 × `getBalance` → **10 billed
calls** (5 `eth_chainId` + 5 `eth_getBalance`, paired into 5 HTTP batches). What
the extra call costs depends entirely on the provider's `eth_chainId` rate.
Only the Infura call count was measured; the overhead column is computed from
the published rates in `providers.md`:

| Provider | `eth_chainId` | Billed overhead on a `getBalance` loop |
|---|---|---|
| Alchemy | 0 CU (5 throughput CU) | none billed, still eats rate limit |
| Infura | 5 credits | +6% |
| QuickNode | 20 credits | **2×** |
| Ankr | 200 credits | **2×** |

Fix — pin the network. `staticNetwork: true` **only takes effect when a network
is also passed**; with `network` undefined it is silently ignored
(`JsonRpcApiProvider` constructor, `lib.esm/providers/provider-jsonrpc.js`,
ethers 6.17.0 — this has shifted across 6.x minors, so re-check on upgrade):

```ts
new JsonRpcProvider(url, 'mainnet', { staticNetwork: true })
// or
new JsonRpcProvider(url, undefined, { staticNetwork: Network.from(1) })
```

Verified: with a static network, 2 × `getBalance` → 2 calls.

## Dependent reads — stage the multicall, don't serialize

"I need `latestRoundData` before I can ask for `getRoundData(roundId - 1)`" is
not a reason to read one call at a time. Split reads by dependency, not by item:

- **Stage A** — every read that needs nothing else, across **all** items, in one multicall.
- **Stage B** — every read that needs a Stage A result, across all items, in a second multicall.

Two round trips total, however many items there are.

Measured 2026-10-24 on the Base public RPC, checking 11 Chainlink-style feeds
(description, decimals, `latestRoundData`, `phaseId`, a TWAP read, then
`phaseAggregators` + 5 × `getRoundData` from the results):

| | `eth_call`s | Wall time |
|---|---:|---:|
| Per feed, per read, `sleep(150)` between each | 121 | 49.9 s |
| 2-stage `client.multicall` | **5** | **0.65 s** |

Outputs were identical. Two caveats on the numbers: ~18 s of the 49.9 s was the
deliberate `sleep(150)` calls, so the latency ratio is inflated by them; and 5
rather than 2 calls is viem's default 1,024-byte multicall chunking (see
[automatic batching](#automatic-batching--the-setting-almost-nobody-turns-on)) —
`batchSize: 0` sends 2 (measured: 2 calls, 0.61 s, all 121 reads successful). Use `allowFailure: true` so one feed with short history
doesn't throw away the rest.

**An unconditional `sleep()` between reads is a symptom.** It means the code is
dodging a rate limit by spending time instead of calls. Aggregating removes the
reason for the sleep. (Backoff *after* a 429 is fine — that's error handling,
not a pacing loop.)

## Sizing a multicall

- **Alchemy `eth_call` gas cap: 550,000,000 gas** per request (Ethereum, Polygon, Optimism, Arbitrum). The node executes every sub-call in one frame, so this is the real ceiling.
- **Alchemy response cap: 150 MB.** JSON-RPC batch cap: **1,000 over HTTP, 20 over WebSocket** — and Alchemy's own best-practices page says "aim for batches under 50."
- **Ankr batch caps: 10 (public) / 100 (freemium) / 1,000 (premium).** Over-size returns `-32062`.
- Practical: **200–500 simple reads** per multicall, **50–100** for heavy ones (v3 `slot0` + ticks, oracle aggregation). If a multicall fails opaquely, halve it before debugging anything else.

## `eth_getLogs`

Provider limits differ in *kind*, not just degree — a chunking strategy keyed
only on block range is wrong for Infura.

| Provider | Limit model |
|---|---|
| **Alchemy** | Block range: **10 on Free**, unlimited on PAYG for major chains, 10k elsewhere. 150 MB response cap. Costs 60 CU. |
| **Infura** | **No block-range cap.** Instead: max 10,000 results, max 5,000 params, 10s query timeout — all `-32005`. Costs **255 credits** (its most expensive common method). |
| **Ankr** | Block range **1,000 / 3,000 / 10,000** by tier (Polygon temporarily 100/1,000). Over-range → `-32062`. |
| **QuickNode** | **5 blocks on free trial, 10,000 on paid.** |

Rules: always constrain `topics[0]`; never `fromBlock: 'earliest'` on a hot path;
cache the last processed block and query forward; on overflow **bisect the range**
rather than retrying. One `eth_getLogs` over a range beats N `eth_call`s checking
each item's state.

## Cache-forever list

Fetch once, persist — none of these change for a given address:

- ERC-20 `decimals()`, `symbol()`, `name()`
- `eth_getCode` for a deployed contract
- Any finalized block or confirmed receipt
- Uniswap v3 pool `token0`, `token1`, `fee`, `tickSpacing`
- Proxy implementation address — *unless* upgradeable; then TTL it

Infura's documented guidance agrees: "blocks more than a couple of blocks below
the head of the chain can be cached indefinitely."
