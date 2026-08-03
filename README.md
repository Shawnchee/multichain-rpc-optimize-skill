# rpc-optimize

A [Claude Code](https://claude.com/claude-code) skill for cutting JSON-RPC costs
on EVM and Solana — with a dependency-free benchmark harness to prove the
numbers on your own endpoint.

Covers **Alchemy, Infura, Ankr, QuickNode, and Helius**. Every cost figure was
read from the provider's own docs on 2026-08-04, with source URLs. Where a
provider documents nothing, this skill says so instead of guessing.

## The thing most people get wrong

**JSON-RPC batching does not save money.** It merges HTTP round-trips. Every
provider that documents the rule bills each method inside the batch — and
**Infura bills N+1**, making batching there strictly worse than serial.

What saves money is **aggregation**: collapsing N logical reads into one billable
call. Measured, not estimated:

| 50 EVM balance reads | Alchemy | Infura | Ankr | QuickNode |
|---|---|---|---|---|
| serial (50 × `eth_call`) | 1,300 CU | 4,000 | 10,000 | 1,000 |
| JSON-RPC batch | 1,300 CU | **4,080** | 10,000 | 1,000 |
| **Multicall3 (1 × `eth_call`)** | **26 CU** | **80** | **200** | **20** |

| 40 Solana account reads | Alchemy | Helius | Ankr | QuickNode | Infura |
|---|---|---|---|---|---|
| serial (40 × `getAccountInfo`) | 400 CU | 40 | 20,000 | 1,200 | 6,400 |
| JSON-RPC batch | 400 CU | 40 | 20,000 | 1,200 | **6,560** |
| **`getMultipleAccounts`** | **20 CU** | **1** | **500** | **30** | **160** |

The Solana row assumes the protocol max of 100 keys per call. Public endpoints
cap lower — the committed run probed a limit of 10, so it measured ~10× rather
than ~40×. The benchmark prints whatever cap your endpoint actually enforces.

Full output in [`skills/rpc-optimize/benchmarks/RESULTS.md`](skills/rpc-optimize/benchmarks/RESULTS.md).

## Install

```bash
git clone https://github.com/Shawnchee/multichain-rpc-optimize-skill.git
cd multichain-rpc-optimize-skill
./install.sh          # symlinks skills/rpc-optimize into ~/.claude/skills/
```

Or manually:

```bash
ln -s "$PWD/skills/rpc-optimize" ~/.claude/skills/rpc-optimize
```

Then just describe the problem — "I'm hitting my Alchemy daily limit", "too many
RPC calls", "optimize my indexer" — and the skill loads itself.

## Run the benchmarks

Node 18+. No install step, no dependencies.

```bash
cd skills/rpc-optimize/benchmarks
npm run bench                     # both suites

# your own endpoint (recommended — public ones throttle and cap hard)
node bench-evm.mjs    --rpc "$ALCHEMY_URL" --n 200
node bench-solana.mjs --rpc "$HELIUS_URL"  --n 500
```

The benchmarks live **inside** the skill, so an installed skill is
self-contained — Claude can run them without the repo checked out.

Each benchmark runs the same work three ways and **cross-checks every strategy
against a baseline** — a strategy returning different data fails the run.
Rate-limit retries are counted and any timing they affected is labelled, so a
throttled number never gets reported as clean latency.

## What's in the skill

| File | Contents |
|---|---|
| `SKILL.md` | Decision procedure, aggregation vs batching, the two budgets |
| `references/evm.md` | Multicall3, viem/ethers/wagmi, two silent-failure traps, `eth_getLogs` caps |
| `references/solana.md` | `getMultipleAccounts`, Anchor, gPA, DAS, subscriptions |
| `references/providers.md` | Per-method costs and limits for all five providers |
| `references/audit-patterns.md` | ripgrep patterns for finding waste in a codebase |
| `references/benchmarking.md` | How to measure before/after honestly |
| `benchmarks/` | Runnable harness, bundled so the skill is self-contained |

## Findings worth knowing even without the skill

- **Infura's docs call JSON-RPC batching "multi-call."** That's not Multicall3 — following their docs gets you the option that costs N+1.
- **Alchemy bills WebSockets and webhooks at 0.04 CU/byte.** "Migrate polling to subscriptions" is not automatically cheaper there. Price it first.
- **`getProgramAccounts` bills 20 CU but consumes 117 throughput CU on Alchemy** — it eats your rate limit ~6× harder than your quota.
- **Helius `getProgramAccountsV2` costs 1 credit vs 10** for `getProgramAccounts`. A one-line 10× cut.
- **Anchor's `fetchMultiple` chunks at 99, not 100**, and fires chunks concurrently — a 5,000-account fetch bursts 51 parallel requests.
- **viem's `batch: { multicall: true }` silently skips** any read carrying `account`, `value`, `gas`, or `nonce`. **wagmi silently falls back** to N individual calls on chains without Multicall3 configured. Neither throws.
- **QuickNode is flat-rate** (20 credits/method EVM, 30 Solana). The `eth_call = 80` / `eth_getLogs = 255` figures circulating in search results are stale — the live API returns 20.
- **Ankr retains only ~16 hours of Solana history.** Don't build a backfill on it.

## Accuracy

Costs verified 2026-08-04. Providers reprice without notice — re-verify before
quoting as current. Machine-readable rates with source URLs live in
[`skills/rpc-optimize/benchmarks/lib/cost-model.mjs`](skills/rpc-optimize/benchmarks/lib/cost-model.mjs).

Two things this repo deliberately does **not** claim:

- How Helius bills JSON-RPC array batches. Its docs contain no batch clause; the
  cost model marks it `undocumented` rather than assuming.
- Alchemy's free-tier throughput. Alchemy's own pages say both 1,000 CU/s and
  500 CU/s. Neither is hardcoded.

## License

MIT
