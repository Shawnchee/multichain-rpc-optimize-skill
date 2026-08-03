# EVM RPC Optimization

<!-- Verified 2026-08-04 against viem/ethers/wagmi source + provider docs. -->

- [Multicall3](#multicall3)
- [viem](#viem) · [The two silent-failure traps](#the-two-silent-failure-traps)
- [ethers v6](#ethers-v6) · [Sizing](#sizing-a-multicall)
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
