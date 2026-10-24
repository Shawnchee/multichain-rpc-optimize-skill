# rpc-optimize

**Cut JSON-RPC calls and provider costs on EVM and Solana: an agent skill, a
paste-in rule set for any LLM, and a benchmark harness that proves the numbers
on your own endpoint.**

[![skills.sh](https://skills.sh/b/Shawnchee/multichain-rpc-optimize-skill)](https://skills.sh/Shawnchee/multichain-rpc-optimize-skill)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)

Covers **Alchemy · Infura · Ankr · QuickNode · Helius**. Every cost figure is
sourced from the provider's own documentation, dated, and linked.

---

## Use it

Pick the one that matches your tool.

**1. Coding agents with skill support**: Claude Code, Cursor, Codex, Gemini CLI,
Copilot, Cline, Windsurf and ~30 others:

```bash
npx skills add Shawnchee/multichain-rpc-optimize-skill
```

The skill loads only when the problem comes up, and pulls in the EVM or Solana
reference on demand.

**2. Any chat LLM, Cursor rules, or Copilot instructions**: copy the
[rules block below](#paste-in-rules) into ChatGPT, Claude.ai, a `.cursorrules`
file, or `.github/copilot-instructions.md`. It's about 530 words.

**3. Tools that can fetch URLs**: point them at the full skill in one file:

```
https://raw.githubusercontent.com/Shawnchee/multichain-rpc-optimize-skill/main/llms-full.txt
```

([`llms.txt`](llms.txt) is the index, in the [llmstxt.org](https://llmstxt.org) format.)

<details>
<summary>4. Clone and symlink (for local development)</summary>

```bash
git clone https://github.com/Shawnchee/multichain-rpc-optimize-skill.git
cd multichain-rpc-optimize-skill
./install.sh    # symlinks skills/rpc-optimize into ~/.claude/skills/
```

`install.sh` refuses to remove a real directory at the destination; move an
existing skill folder deliberately.
</details>

### Then describe the symptom

> "I'm hitting my Alchemy daily limit"
> "this dashboard makes 400 RPC calls on load"
> "getProgramAccounts keeps timing out"
> "audit this repo for RPC waste"

It works through a fixed order: **stop polling → cache → aggregate → filter
scans → batch (latency only) → dedupe**. Polling comes first because removing
a poll loop routinely beats a perfect multicall. An audit comes back ranked by
calls saved:

```
[high] src/feeds.ts:32 — 11 sequential reads per feed, sleep(150) between each, 11 feeds
  current:  121 eth_call per run (49.9 s)
  proposed: 2-stage Multicall3 (independent reads, then the getRoundData history)
  after:    2 eth_call per run (0.61 s)
```

<sub>That example comes from a real audit (Base mainnet, 2026-10-24); see
[`evm.md`](skills/rpc-optimize/references/evm.md#dependent-reads--stage-the-multicall-dont-serialize).</sub>

---

## The problem this solves

Teams hitting RPC rate limits reach for JSON-RPC batching. Batching does not
reduce cost: it merges HTTP round-trips while every method inside the batch is
still billed. On Infura it is actively worse, because the batch envelope is
billed as an additional request.

What reduces cost is **aggregation**: collapsing N logical reads into one
billable call.

### Measured: 200 ERC-20 balance reads

| Strategy | Latency | Alchemy | Infura | Ankr | QuickNode |
|---|---:|---:|---:|---:|---:|
| Serial (200 × `eth_call`) | 3,508 ms | 5,200 CU | 16,000 | 40,000 | 4,000 |
| JSON-RPC batch | 349 ms | 5,200 CU | **16,080** | 40,000 | 4,000 |
| **Multicall3** (1 × `eth_call`) | **166 ms** | **26 CU** | **80** | **200** | **20** |

**200× cheaper.** Batching was 10× faster and saved nothing, and on Infura it
cost 80 credits *more* than serial.

<details>
<summary>Measured: 60 Solana account reads</summary>

| Strategy | Latency | Alchemy | Helius | Ankr | QuickNode | Infura |
|---|---:|---:|---:|---:|---:|---:|
| Serial (60 × `getAccountInfo`) | 3,818 ms | 600 CU | 60 | 30,000 | 1,800 | 9,600 |
| JSON-RPC batch | 1,426 ms | 600 CU | 60 | 30,000 | 1,800 | **9,760** |
| **`getMultipleAccounts`** | 1,394 ms | **120 CU** | **6** | **3,000** | **180** | **960** |

10× cheaper (5× on Alchemy, which prices `getMultipleAccounts` at 2×
`getAccountInfo`) on a public endpoint capped at 10 keys per call; **60× (30× on
Alchemy) on a keyed endpoint** allowing the protocol maximum of 100. Batching and
aggregation were about equally fast here (1,426 vs 1,394 ms). Only one of them
saved money.
</details>

Full output: [`RESULTS.md`](skills/rpc-optimize/benchmarks/RESULTS.md) ·
Method: [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) ·
Design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Paste-in rules

The condensed version of the skill for tools without skill support. GitHub
shows a copy button on the block. The same text ships as the body of
[`llms.txt`](llms.txt).

<!-- llm-rules:start -->
```text
You are helping reduce JSON-RPC calls and provider costs for an EVM and/or Solana
app. Apply these rules. Do not invent provider prices: if a number is not below,
say it is unverified and point to the provider's pricing page.

COST FACTS (provider docs, verified 2026-08-04)
- JSON-RPC batching (an array of requests in one HTTP call) does NOT cut cost.
  Alchemy, Ankr and QuickNode bill every method inside the batch; Infura bills
  N+1, worse than serial. Helius documents no batch rule; claim nothing.
  Infura's docs call batching "multi-call". That is NOT Multicall3.
- Aggregation DOES cut cost. EVM: Multicall3 at
  0xcA11bde05977b3631167028862bE2a173976CA11 (250+ chains) turns N reads into
  one eth_call. Solana: getMultipleAccounts takes up to 100 accounts per call
  (protocol max; some endpoints cap lower, so probe before chunking by 100).
  Measured: 200 ERC-20 balance reads were 200x cheaper via Multicall3.

DECISION ORDER (stop at the first that applies)
1. Push instead of poll. Polling every 2 s = 43,200 calls/day per watcher. Use
   eth_subscribe / accountSubscribe / webhooks, but price it first: Alchemy
   bills WebSockets and webhooks at 0.04 CU/byte.
2. Cache immutable data forever: ERC-20 decimals/symbol/name, finalized blocks,
   confirmed txs, contract code, mint metadata.
3. Aggregate N reads at one block/slot: Multicall3 (EVM); getMultipleAccounts or
   Anchor fetchMultiple (Solana); DAS getAssetsByOwner for tokens/NFTs.
4. Filter scans. Solana getProgramAccounts: always filters + dataSlice; on Helius
   use getProgramAccountsV2 (1 credit vs 10). On Alchemy, gPA bills 20 CU but
   consumes 117 throughput CU. EVM eth_getLogs: set topics[0], keep block ranges
   tight, never fromBlock 'earliest' on a hot path.
5. Batch only for latency, never for cost, and not at all on Infura.
6. Dedupe: one query cache (e.g. React Query staleTime) so components don't
   refetch the same value.

WHEN WRITING CODE
- No RPC call inside a for/map loop. Promise.all(items.map(read)) is a multicall
  waiting to happen.
- Dependent reads still aggregate: one multicall for everything independent, a
  second for what needs its results. An unconditional sleep() between reads is
  rate-limit dodging; aggregate instead.
- Pin blockNumber/slot when aggregating. Request the narrowest data: dataSlice,
  base64 over jsonParsed, specific log topics.
- Keep provider keys server-side. NEXT_PUBLIC_* keys get scraped and drained.

LIBRARY TRAPS (silent: nothing throws)
- viem: set batch: { multicall: true } on the client. Reads that pass account,
  value, gas or nonce skip it and go out one by one. client.multicall returns
  { result, status: 'success' } | { error, status: 'failure' }, not
  data/'reverted' as the docs page says.
- wagmi: if the chain config lacks contracts.multicall3, readContracts silently
  falls back to N separate eth_calls.
- ethers v6: no built-in Multicall3 (call aggregate3 through a Contract).
  batchMaxCount is JSON-RPC batching; set it to 1 on Infura. Build providers
  with a static network, new JsonRpcProvider(url, 'mainnet', { staticNetwork:
  true }), or every high-level call (getBalance, contract reads...) also sends
  eth_chainId (2x the bill on QuickNode and Ankr). staticNetwork: true without
  a network argument is ignored.
- Anchor: use program.account.x.fetchMultiple(keys), not keys.map(fetch).
  program.account.x.all() is a getProgramAccounts scan.

LIMITS
- Multicall3 is EVM-only. On Solana the answer is getMultipleAccounts.
- Multicall3 reads at one block; it cannot make archive queries cheap.
- Providers reprice without notice. Re-check before quoting a rate as current.

When auditing, rank fixes by calls saved per day and show before/after counts.
```
<!-- llm-rules:end -->

---

## Findings

Documented behaviour that is easy to get wrong, verified against primary sources
and library internals:

| Finding | Why it matters |
|---|---|
| Infura's docs call JSON-RPC batching **"multi-call"** | Not Multicall3. Following their docs leads to the option that costs N+1. |
| Alchemy bills WebSockets and webhooks at **0.04 CU/byte** | "Migrate polling to subscriptions" is not automatically cheaper. Price it first. |
| `getProgramAccounts` bills 20 CU but consumes **117 throughput CU** on Alchemy | Consumes rate limit ~6× harder than quota. ~85 req/s, not 500. |
| Helius `getProgramAccountsV2` costs **1 credit vs 10** | A one-line, 10× reduction on their most expensive standard method. |
| Anchor's `fetchMultiple` chunks at **99**, not 100, concurrently | A 5,000-account fetch bursts 51 parallel requests and trips per-second limits. |
| viem's `batch: { multicall: true }` **silently skips** reads carrying `account`, `value`, `gas`, or `nonce` | Degrades to N individual calls with no error. |
| wagmi **silently falls back** to N reads on chains without `multicall3` configured | Same failure, different cause. Nothing throws. |
| viem's multicall docs misstate the return shape | Docs say `data` / `'reverted'`; the shipped type is `result` / `'failure'`. |
| ethers v6 sends a hidden **`eth_chainId` with every high-level call** unless the network is static | 2× billed calls (measured on Infura); 2× the bill on QuickNode and Ankr. `staticNetwork: true` is ignored without a network argument. |
| Dependent reads still aggregate, as **two staged multicalls** | 11 oracle feeds: 121 `eth_call`s in 49.9 s → 2 calls in 0.61 s, identical outputs. |
| QuickNode is flat-rate: 20 credits/method EVM, 30 Solana | The `eth_call = 80` and `eth_getLogs = 255` figures in search results are stale. |
| Ankr retains only **~16 hours** of Solana history | Do not build a backfill on it. |

---

## Running the benchmarks

Node ≥18. No dependencies, no install step.

```bash
cd skills/rpc-optimize/benchmarks
npm run bench                                    # both suites

node bench-evm.mjs    --rpc "$ALCHEMY_URL" --n 200
node bench-solana.mjs --rpc "$HELIUS_URL"  --n 500
```

| Flag | Default | Meaning |
|---|---|---|
| `--n` | 50 / 60 | Number of logical reads |
| `--runs` | 3 | Repetitions; median reported |
| `--rpc` | public endpoint | Endpoint under test |

Prefer your own endpoint. Public ones throttle and impose caps that understate
the savings.

---

## Accuracy policy

Provider rates were verified **2026-08-04** and are dated in
[`providers.md`](skills/rpc-optimize/references/providers.md) and
[`cost-model.mjs`](skills/rpc-optimize/benchmarks/lib/cost-model.mjs) with source
URLs. Providers reprice without notice; re-verify before quoting as current.

The governing rule is that **an absent number is safer than a remembered one.**
Two consequences worth stating plainly:

- **How Helius bills JSON-RPC array batches is not claimed.** Their documentation
  contains no batch clause. The cost model marks it `undocumented`.
- **Alchemy's free-tier throughput is not hardcoded.** Alchemy's own pages state
  both 1,000 CU/s and 500 CU/s. The contradiction is recorded instead of resolved.

See [`docs/COST-MODEL.md`](docs/COST-MODEL.md) for the verification process and
how to refresh the data.

---

<details>
<summary>Repository layout</summary>

```
skills/rpc-optimize/          the installable skill
├── SKILL.md                  decision procedure, loaded on activation
├── references/               loaded on demand, never all at once
│   ├── evm.md                Multicall3, viem/ethers/wagmi, eth_getLogs caps
│   ├── solana.md             getMultipleAccounts, Anchor, gPA, DAS
│   ├── providers.md          per-method costs and limits, all five providers
│   ├── audit-patterns.md     ripgrep patterns for finding waste
│   └── benchmarking.md       how to measure honestly
└── benchmarks/               bundled so the skill is self-contained
    ├── bench-evm.mjs
    ├── bench-solana.mjs
    ├── lib/cost-model.mjs    provider rates, with sources and dates
    └── RESULTS.md

llms.txt                      index + paste-in rules (generated)
llms-full.txt                 the whole skill in one file (generated)
scripts/build-llms.mjs        regenerates both; --check fails on drift

docs/                         technical documentation
├── METHODOLOGY.md            benchmark design and how to read results
├── COST-MODEL.md             provider data and the verification policy
└── ARCHITECTURE.md           skill design and why this is one skill, not three
```
</details>

## Contributing

Adding a provider or a benchmark is documented in
[`docs/COST-MODEL.md`](docs/COST-MODEL.md) and
[`docs/METHODOLOGY.md`](docs/METHODOLOGY.md). One rule is non-negotiable: every
cost figure needs a primary-source URL and a verification date. Figures from blog
posts, search summaries, or memory are not accepted.

After editing the skill or the paste-in rules, run `node scripts/build-llms.mjs`
and commit the regenerated `llms.txt` / `llms-full.txt`.

## License

[MIT](LICENSE)
