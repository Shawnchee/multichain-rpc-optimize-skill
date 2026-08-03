# rpc-optimize

**An agent skill for reducing JSON-RPC cost on EVM and Solana — with a benchmark
harness that proves the numbers on your own endpoint.**

[![skills.sh](https://skills.sh/b/Shawnchee/multichain-rpc-optimize-skill)](https://skills.sh/Shawnchee/multichain-rpc-optimize-skill)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)

Covers **Alchemy · Infura · Ankr · QuickNode · Helius**. Every cost figure is
sourced from the provider's own documentation, dated, and linked. Where a
provider documents nothing, this repo says so rather than guessing.

---

## The problem this solves

Teams hitting RPC rate limits reach for JSON-RPC batching. Batching does not
reduce cost — it merges HTTP round-trips while every method inside the batch is
still billed. On Infura it is actively worse, because the batch envelope is
billed as an additional request.

What reduces cost is **aggregation**: collapsing N logical reads into one
billable call. The difference is not marginal.

### Measured — 200 ERC-20 balance reads

| Strategy | Latency | Alchemy | Infura | Ankr | QuickNode |
|---|---:|---:|---:|---:|---:|
| Serial (200 × `eth_call`) | 3,501 ms | 5,200 CU | 16,000 | 40,000 | 4,000 |
| JSON-RPC batch | 342 ms | 5,200 CU | **16,080** | 40,000 | 4,000 |
| **Multicall3** (1 × `eth_call`) | **166 ms** | **26 CU** | **80** | **200** | **20** |

**200× cheaper.** Batching was 10× faster and saved nothing — and cost 80 credits
*more* than serial on Infura.

### Measured — 60 Solana account reads

| Strategy | Latency | Alchemy | Helius | Ankr | QuickNode | Infura |
|---|---:|---:|---:|---:|---:|---:|
| Serial (60 × `getAccountInfo`) | 3,674 ms | 600 CU | 60 | 30,000 | 1,800 | 9,600 |
| JSON-RPC batch | 1,248 ms | 600 CU | 60 | 30,000 | 1,800 | **9,760** |
| **`getMultipleAccounts`** | 1,406 ms | **120 CU** | **6** | **3,000** | **180** | **960** |

10× on a public endpoint capped at 10 keys per call; **60× on a keyed endpoint**
allowing the protocol maximum of 100. Note that aggregation was marginally
*slower* than batching here while being 10× cheaper — cost and latency are
separate wins.

Full output: [`RESULTS.md`](skills/rpc-optimize/benchmarks/RESULTS.md) ·
Method: [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) ·
Design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Install

```bash
npx skills add Shawnchee/multichain-rpc-optimize-skill
```

Installs to Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline, Windsurf and
~30 other agents. The benchmark harness is bundled, so it travels with the skill.

<details>
<summary>Clone and symlink instead (for local development)</summary>

```bash
git clone https://github.com/Shawnchee/multichain-rpc-optimize-skill.git
cd multichain-rpc-optimize-skill
./install.sh    # symlinks skills/rpc-optimize into ~/.claude/skills/
```

`install.sh` refuses to remove a real directory at the destination — move an
existing skill folder deliberately.
</details>

### Using it

The skill activates on the problem, not on a command. Describe the symptom:

> "I'm hitting my Alchemy daily limit"
> "this dashboard makes 400 RPC calls on load"
> "getProgramAccounts keeps timing out"
> "reduce our Helius credit usage"

It detects the chain from your dependencies, loads only the relevant reference,
and works through a fixed decision procedure — polling first, aggregation later,
because eliminating a poll loop routinely beats a perfect multicall.

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

Always prefer your own endpoint. Public ones throttle and impose caps that
understate the savings.

---

## Repository layout

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

docs/                         technical documentation
├── METHODOLOGY.md            benchmark design and how to read results
├── COST-MODEL.md             provider data and the verification policy
└── ARCHITECTURE.md           skill design and why this is one skill, not three
```

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
| Anchor's `fetchMultiple` chunks at **99**, not 100 — concurrently | A 5,000-account fetch bursts 51 parallel requests and trips per-second limits. |
| viem's `batch: { multicall: true }` **silently skips** reads carrying `account`, `value`, `gas`, or `nonce` | Degrades to N individual calls with no error. |
| wagmi **silently falls back** to N reads on chains without `multicall3` configured | Same failure, different cause. Nothing throws. |
| viem's multicall docs misstate the return shape | Docs say `data` / `'reverted'`; the shipped type is `result` / `'failure'`. |
| QuickNode is flat-rate: 20 credits/method EVM, 30 Solana | The `eth_call = 80` and `eth_getLogs = 255` figures in search results are stale. |
| Ankr retains only **~16 hours** of Solana history | Do not build a backfill on it. |

---

## Accuracy policy

Provider rates were verified **2026-08-04** and are dated in
[`providers.md`](skills/rpc-optimize/references/providers.md) and
[`cost-model.mjs`](skills/rpc-optimize/benchmarks/lib/cost-model.mjs) with source
URLs. Providers reprice without notice — re-verify before quoting as current.

The governing rule is that **an absent number is safer than a remembered one.**
Two consequences worth stating plainly:

- **How Helius bills JSON-RPC array batches is not claimed.** Their documentation
  contains no batch clause. The cost model marks it `undocumented`.
- **Alchemy's free-tier throughput is not hardcoded.** Alchemy's own pages state
  both 1,000 CU/s and 500 CU/s. The contradiction is recorded instead of resolved.

See [`docs/COST-MODEL.md`](docs/COST-MODEL.md) for the verification process and
how to refresh the data.

---

## Contributing

Adding a provider or a benchmark is documented in
[`docs/COST-MODEL.md`](docs/COST-MODEL.md) and
[`docs/METHODOLOGY.md`](docs/METHODOLOGY.md). One rule is non-negotiable: every
cost figure needs a primary-source URL and a verification date. Figures from blog
posts, search summaries, or memory are not accepted.

## License

[MIT](LICENSE)
