# RPC Waste Audit

Run this against an existing project before proposing changes. Rank findings by
estimated daily call volume, not by how easy they are to fix.

## 1. Find the RPC surface

```bash
rg -n --type-add 'w:*.{ts,tsx,js,jsx,mjs}' -tw \
  -e 'createPublicClient|createWalletClient|new Connection|JsonRpcProvider|AnchorProvider|new Web3'

rg -n -e 'alchemy\.com|helius|quiknode|quicknode|ankr|infura|rpcpool|triton|drpc' \
  -g '!node_modules' -g '!*.lock'

rg -n 'NEXT_PUBLIC_.*(RPC|ALCHEMY|HELIUS|QUICKNODE|INFURA|ANKR)' -g '!node_modules'
```

A `NEXT_PUBLIC_` provider key is a finding on its own — scrapeable, and anyone
can drain your quota. Common cause of "mystery overage" that no batching fixes.

Identify the provider: it determines which levers pay. Ankr at 200 credits/EVM
call rewards aggregation ~10× more than QuickNode at 20.

## 2. RPC calls inside loops — aggregation candidates

```bash
# Promise.all over a map containing a read — the classic multicall candidate
rg -n -U 'Promise\.all\([\s\S]{0,200}?\.map\([\s\S]{0,300}?(readContract|\.read\.|getAccountInfo|\.fetch\(|call\()'

# await inside for/forEach
rg -n -B2 -A2 'for\s*\(.*\)\s*\{' -g '*.ts' -g '*.tsx' \
  | rg -B2 -A2 'await.*(getAccountInfo|readContract|\.read\.|provider\.|connection\.)'

# Anchor: per-account fetch that should be fetchMultiple
rg -n 'program\.account\.\w+\.fetch\(' -g '*.ts' -g '*.tsx'
```

## 3. Polling — usually the biggest number

```bash
rg -n 'setInterval|refetchInterval|refreshInterval|useInterval|pollingInterval'
```

For each hit record the interval and what it fetches:

```
daily_calls = 86400 / interval_seconds × items_fetched × concurrent_users
```

Anything under 10s that isn't a price feed deserves a challenge. Anything polling
`getProgramAccounts`, `eth_getLogs`, or `getSignatureStatuses` should become a
subscription or webhook — **but price the subscription first** (Alchemy bills
WS/webhooks at 0.04 CU/byte; it is not automatically cheaper).

## 4. Uncached immutable reads

```bash
rg -n "functionName:\s*'(decimals|symbol|name)'|\.decimals\(\)|\.symbol\(\)"
rg -n 'findProgramAddress|findProgramAddressSync'
rg -n 'getMint|getTokenSupply|getParsedAccountInfo'
```

Anything here not behind a long/infinite TTL cache is a finding.

## 5. Solana-specific

```bash
rg -n 'getProgramAccounts|\.account\.\w+\.all\('     # 10 credits on Helius, 117 throughput CU on Alchemy
rg -n 'getLargestAccounts'                            # 3000 CU on Alchemy
rg -n 'getSignaturesForAddress|getTransactionsForAddress'
rg -n "encoding:\s*'jsonParsed'"                      # larger payloads, blocks dataSlice
rg -n 'dataSlice'                                     # presence is good; absence near gPA is a finding
```

For every `getProgramAccounts` / `.all(`: does it pass `filters` **and**
`dataSlice`? Unfiltered = finding. On Helius, does `getProgramAccountsV2` apply?
That alone is 10×.

## 6. EVM-specific

```bash
rg -n "fromBlock:\s*['\"]earliest|fromBlock:\s*0"     # unbounded log queries
rg -n 'getLogs' -A3                                    # topic filters present?
rg -n 'batchMaxCount'                                  # ethers batching — disable on Infura
```

⚠️ **These two are inverted — no match IS the finding.** Every other pattern in
this file reports a hit as a problem; these report an absence as a problem.
Don't skip them because they came back empty.

```bash
rg -n 'batch:\s*\{'                 # viem batching configured at all?
rg -n 'multicall3|multicallAddress' # chain config aware of Multicall3?
```

A viem client issuing many `readContract` calls with **no** `batch: { multicall: true }`
is a one-line, high-leverage fix. And a chain config with **no** `multicall3`
entry means wagmi is silently falling back to N individual `eth_call`s
(see `evm.md` → silent-failure traps) — nothing throws, so grep is how you find it.

**On Infura specifically**, any JSON-RPC array batching is *worse* than serial
(N+1 billing). Look for `batchMaxCount` > 1 in ethers and transport-level
`batch` in viem and recommend disabling them.

## 7. Missing dedupe layer

```bash
rg -n '@tanstack/react-query|swr|useQuery' package.json src 2>/dev/null
```

Same read fired from multiple components with no query cache = N separate calls.
A sane `staleTime` often halves traffic before any protocol work.

## Reporting format

```
[severity] location:line — what
  current:  N calls/day × C units = X units/day
  proposed: <specific change>
  after:    Y units/day  (Z× reduction)
```

Rank by `X - Y` (absolute units saved), not by severity label. A boring
`staleTime` change saving 8M CU beats an elegant multicall saving 40k.

## Fix order

1. Exposed keys (may be the entire problem)
2. Raise/remove poll intervals; convert pollers to subscriptions **after pricing them**
3. Cache immutable data
4. Aggregate loops → Multicall3 / `getMultipleAccounts` / `fetchMultiple`
5. Add filters + `dataSlice` to scans
6. Enable transport batching for latency — **skip on Infura**
7. Query cache for cross-component dedupe

Measure after each step (see `benchmarking.md`). Stop when comfortably under
quota — further optimization has real complexity cost.
