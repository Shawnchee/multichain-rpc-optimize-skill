# Architecture

Why the skill is shaped the way it is. Recorded because the obvious alternatives
were considered and rejected for measured reasons, and someone will propose them
again.

- [Progressive disclosure](#progressive-disclosure)
- [Why one skill and not three](#why-one-skill-and-not-three)
- [Why benchmarks live inside the skill](#why-benchmarks-live-inside-the-skill)
- [Ordering of the decision procedure](#ordering-of-the-decision-procedure)
- [Revisit triggers](#revisit-triggers)

## Progressive disclosure

An agent skill loads in three stages, and the design follows that grain:

| Stage | Content | When loaded |
|---|---|---|
| 1 | `name` + `description` | Always resident, every session |
| 2 | `SKILL.md` body | On activation |
| 3 | `references/*`, `benchmarks/*` | Only when read |

Consequences that drove the layout:

- **The description is the entire trigger surface.** It enumerates symptoms
  ("hitting my daily limit", "429 errors", "getProgramAccounts is slow") rather
  than describing the skill abstractly, because matching happens against how
  users phrase problems.
- **`SKILL.md` stays short** (126 lines, 93 non-blank body). It holds the decision procedure and
  nothing chain-specific beyond a routing instruction.
- **Chain detail lives in `references/`**, so an EVM session never loads the
  Solana material. This is where the real context saving comes from.

`SKILL.md` instructs the agent to detect the chain from project dependencies
(`viem`/`ethers`/`wagmi`/`hardhat` versus `@solana/web3.js`/`@coral-xyz/anchor`/
`Anchor.toml`) and read only the matching reference. It explicitly warns that a
provider name does not imply a chain — Alchemy, Ankr, QuickNode and Infura all
serve both.

## Why one skill and not three

The natural refactor is `rpc-optimize` + `rpc-optimize-evm` +
`rpc-optimize-solana`. It was measured and rejected.

**The shared core dominates.** Of `SKILL.md`'s 93 non-blank body lines, the
script below tags 11 as EVM and 16 as Solana; the other 66 (**~71%**) are
chain-agnostic — the two-budget framing, the batching-versus-aggregation
correction, the decision procedure, the spend formula. Splitting duplicates that
shared core into two files that must then be kept in sync, to save each session
~15 lines.

**The split already exists at the layer that matters.** The two chain references
are 409 of the skill's 1,009 markdown lines (**41%**) and already load only on
demand. A three-way split adds nothing there.

Reproduce the split:

```bash
body=$(sed -n '/^---$/,/^---$/!p' skills/rpc-optimize/SKILL.md | grep -v '^\s*$')
echo "$body" | wc -l                                    # total body lines
echo "$body" | grep -icE 'multicall3|eth_call|viem|\bEVM\b'          # EVM-tagged
echo "$body" | grep -icE 'getMultipleAccounts|anchor|solana|helius'  # Solana-tagged
```

**Splitting worsens the always-resident cost.** Descriptions are resident in
every session; bodies are not. Three skills mean three descriptions permanently
in context to avoid loading ~15 lines of irrelevant chain content occasionally.

**It creates a routing problem that does not currently exist.** "I'm hitting my
Alchemy daily limit" names no chain, and Alchemy serves both. With one skill
there is nothing to disambiguate.

### The decisive argument: split-brain failure

A chain skill triggered alone optimizes locally and misses the larger win.

> A user polls 10 balances every 2 seconds and asks to "batch these `eth_call`s
> with multicall." Only the EVM skill activates. It produces a correct Multicall3
> refactor — a 10× saving — while the *stop polling* answer (75×) never enters
> context, because the decision procedure lived in a skill that never loaded.

The monolith cannot fail this way: its body always evaluates "is this
push-able?" before any tactic. The failure is silent and produces
confident-looking work, which is the worst kind.

Mitigation in a split design costs ~15 duplicated lines per chain skill plus an
explicit tripwire, and still relies on the agent honouring a handoff. Not worth
it absent a distribution motive.

## Why benchmarks live inside the skill

They were originally at the repository root. That was a real bug:
`references/benchmarking.md` told the agent to run
`node benchmarks/bench-evm.mjs`, but the skill installs as a symlink to
`skills/rpc-optimize/`, where that path does not exist. The instruction was
unrunnable from any real installation.

Moving `benchmarks/` under the skill makes an installed skill self-contained. It
also survives `npx skills add`, which copies the skill directory — verified by
installing from GitHub into a clean directory and running the harness from the
installed path.

The cost is nil: bundled files are stage-3 content and consume no context until
read.

## Ordering of the decision procedure

The six steps are ordered by expected saving, not by elegance:

1. Eliminate polling
2. Cache immutable data
3. Aggregate reads at one block/slot
4. Filter and slice scans
5. Batch — for latency only
6. Deduplicate across components

Steps 1 and 2 are unglamorous and routinely worth more than step 3. A dashboard
polling 10 balances every 2 seconds costs 11.2M CU/day on Alchemy; Multicall3
brings it to 1.1M (10×), but simply moving the interval to 15 seconds brings it
to 150k (75×) and costs nothing to implement.

Batching sits at step 5 with an explicit "latency, never cost" qualifier, and is
marked *skip entirely* on Infura, where the N+1 envelope makes it worse than
doing nothing.

## Revisit triggers

Reopen the one-skill decision if any of these become true:

- `SKILL.md` exceeds ~200 body lines (currently 89; the documented ceiling is 500)
- A third chain family is added — Sui, Bitcoin, Cosmos — changing how the
  agnostic core amortises
- The EVM and Solana decision procedures diverge; today both are
  poll → cache → aggregate → filter → batch → dedupe
- The chain skills need to be distributed independently to different audiences,
  which is the one motive that genuinely favours a split
