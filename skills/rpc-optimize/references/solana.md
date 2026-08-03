# Solana RPC Optimization

<!-- Verified 2026-08-04 against solana.com/docs, anchor source, Helius/Alchemy/Ankr docs. -->

**There is no Multicall3 on Solana.** It's an EVM contract. Solana's equivalents
are RPC methods that already accept arrays, plus DAS and subscriptions. "Multicall
for Anchor" means `getMultipleAccounts` or `fetchMultiple`.

- [getMultipleAccounts](#getmultipleaccounts) · [Anchor](#anchor)
- [getProgramAccounts](#getprogramaccounts--the-expensive-trap) · [DAS](#das-api--tokens-and-nfts)
- [Stop polling](#stop-polling) · [Confirmation](#transaction-confirmation) · [Caching](#cache-forever-list)

## `getMultipleAccounts`

Documented max **100 accounts per call**. Measured cost for 40 reads:

| | Alchemy | Helius | Ankr | QuickNode | Infura |
|---|---|---|---|---|---|
| 40 × `getAccountInfo` | 400 CU | 40 | 20,000 | 1,200 | 6,400 |
| 1 × `getMultipleAccounts` | 20 CU | 1 | 500 | 30 | 160 |

```ts
const infos = await connection.getMultipleAccountsInfo(pubkeys, {
  commitment: 'confirmed',
  dataSlice: { offset: 0, length: 40 },
})
```

Chunk by 100 for larger sets. Oversized requests are rejected, not truncated.

**`dataSlice` is only available for `base58`, `base64`, `base64+zstd`, and
`binary` — not `jsonParsed`.** Measured impact on 8 accounts: full `base64` =
142,073 bytes, `dataSlice(0,32)` = **1,729 bytes**. Identical billable cost,
99% less payload.

⚠️ Some endpoints cap the array below 100 — public `solana-rpc.publicnode.com`
rejects arrays in the low teens with `blocked parameter`. Probe your endpoint
before assuming 100.

## Anchor

```ts
const positions = await program.account.position.fetchMultiple(pubkeys)
const all = await program.account.position.all([
  { memcmp: { offset: 8, bytes: owner.toBase58() } },
])
```

**`fetchMultiple` chunks at 99, not 100** (`GET_MULTIPLE_ACCOUNTS_LIMIT = 99` in
`anchor/ts/packages/anchor/src/utils/rpc.ts`), and it fires those chunks
**concurrently via `Promise.all`**. A 5,000-account `fetchMultiple` bursts 51
simultaneous requests — that, not the credit cost, is what trips per-second rate
limits. Throttle it yourself if you're on a low tier (Helius Free is 10 req/s).

Returns `null` both for accounts that don't exist **and for accounts whose
discriminator doesn't match** the requested type — silently, not as an error.
Don't assume index alignment implies existence.

`.all(filters)` maps to `getProgramAccounts` and prepends Anchor's own
discriminator `memcmp` (plus a `dataSize` filter when the coder supplies one).
Since the RPC caps filters at 4, Anchor's auto-filters eat 1–2 of your budget —
you get 2–3 of your own.

Prefer `fetchMultiple` over `Promise.all(pks.map(pk => program.account.x.fetch(pk)))`.
That map is the #1 Anchor frontend quota leak.

## `getProgramAccounts` — the expensive trap

| | Alchemy | Helius | Ankr | QuickNode |
|---|---|---|---|---|
| `getProgramAccounts` | 20 CU **/ 117 throughput CU** | **10** | 500 | 30 |
| `getProgramAccountsV2` | — | **1** | — | — |

Two things to know:

1. **On Alchemy it bills 20 CU but consumes 117 throughput CU** — it eats your
   rate limit ~6× harder than your quota. At 10,000 CU/s that's ~85 req/s, not 500.
2. **On Helius, `getProgramAccountsV2` is 1 credit vs 10** — a documented 10×
   cut for a method swap. It's a Helius extension (not standard RPC) with
   cursor pagination (`paginationKey`, `limit` 1–10,000) and `changedSinceSlot`,
   which eliminates full re-scans for incremental indexing.

Rules:
- **Always filter.** Max **4 filter objects**; `memcmp` decoded data is **limited to 128 bytes**. `dataSize` for fixed-layout accounts.
- **Always `dataSlice`.** Need only pubkeys? `dataSlice: { offset: 0, length: 0 }`.
- **Never on an interval.** Polling gPA means you want a webhook or a stream.
- Helius gives gPA its own rate bucket: **5 / 25 / 50 / 75 req/s** by tier.
- No result-size cap or timeout is documented in the core Solana spec — those are provider-dependent, so handle failure.

## DAS API — tokens and NFTs

**DAS is a Metaplex standard**, not a Helius invention — multiple providers
implement it. Methods: `getAsset`, `getAssetBatch`, `getAssetProof`,
`getAssetsByOwner`, `getAssetsByGroup`, `getAssetsByCreator`,
`getAssetsByAuthority`, `searchAssets`, `getSignaturesForAsset`,
`getNftEditions`, `getTokenAccounts`.

Don't iterate `getTokenAccountsByOwner` → `getAccountInfo` per mint → metadata
PDA per mint. That's 200+ calls for one wallet. `searchAssets` with
`tokenType: 'all'` usually replaces an entire portfolio-loading routine in one call.

Pricing: **Helius 10 credits, QuickNode 60, Infura 160** per DAS request — more
than a plain RPC call, but replacing hundreds of them. `getAssetsByOwner` and
`getAssetBatch` document `limit` up to 1,000; other DAS methods don't publish a
documented per-page maximum.

Note Helius extends DAS to cover plain SPL and Token-2022 fungibles — that
coverage is **not portable** to other DAS providers.

## Stop polling

`getAccountInfo` every second on 10 accounts = 864,000 calls/day.

```ts
const subId = connection.onAccountChange(pubkey, (info, ctx) => { /* pushed */ }, 'confirmed')
connection.removeAccountChangeListener(subId)   // always clean up
```

Methods: `accountSubscribe`, `programSubscribe` (accepts the **same filters and
same 4-filter cap** as gPA — this replaces a gPA poll loop), `logsSubscribe`,
`signatureSubscribe`, `blockSubscribe`, `slotSubscribe`.

**Price the subscription before migrating** — it is not automatically cheaper:

| Provider | Subscription pricing |
|---|---|
| Alchemy | **0.04 CU/byte** (~40 CU per typical 1 KB event). A chatty subscription can exceed the polling it replaced. |
| Helius | 1 credit to open; webhook event delivered = 1 credit; LaserStream 2 credits/0.1 MB |
| Ankr | EVM 200/sub + 100/notification; Solana 500/sub + 500/notification |

**Delivery guarantees are not documented.** Nothing in solana.com/docs states
ordering or at-least-once delivery for WS subscriptions. Assume drops: implement
reconnect **plus a reconciliation fetch on reconnect**, and for anything
financial reconcile against a slot-indexed source. (The commonly cited claim that
standard WSS delivers in random order comes from a Helius *blog post*, not spec.)

**Helius webhooks** — Enhanced / Raw / Discord; up to 100,000 addresses per
webhook via API; 1 credit per delivered event, 100 credits per create/edit/delete.
Cheaper than polling only when event rate < poll rate. Max webhooks: 5 (Free),
50 (paid tiers).

**LaserStream / Geyser gRPC** — wire-compatible with Yellowstone, 2 credits per
0.1 MB. The right tier for firehose indexing. Note Helius docs do *not* contain a
head-to-head "use this instead of polling" recommendation — don't attribute one.

## Transaction confirmation

```ts
await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
```

Don't poll `getSignatureStatuses` in a tight loop. If you must, poll at ≥2s with
backoff and a hard deadline at `lastValidBlockHeight` — past that the tx can
never land, so continuing is pure waste. `getSignatureStatuses` accepts up to
**256 signatures per call**; use the array.

## Cache-forever list

- Mint decimals; supply at a finalized slot
- Token metadata for immutable metadata accounts
- Any finalized transaction or block
- **PDAs — derive once and memoize.** `findProgramAddressSync` is local compute, not RPC, but it loops bumps and gets called in render paths constantly.
- Program IDL — import from your build

⚠️ **Ankr retains only ~16 hours of Solana history** (~100M ledger size).
`getTransaction`, `getBlock`, `getSignaturesForAddress` return null/error beyond
that. Don't build an indexer backfill on Ankr.

## Context-budget notes

When an agent consumes this data:

- `encoding: 'base64'` and decode yourself — `jsonParsed` is larger and costs more to hand to a model (measured above: no smaller, and it blocks `dataSlice`).
- `dataSlice` aggressively — 99% payload reduction measured.
- Write large results to a file; read back selected fields.
- `getTransaction` with `jsonParsed` produces enormous objects. Project before logging.
