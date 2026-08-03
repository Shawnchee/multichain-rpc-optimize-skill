#!/usr/bin/env node
/**
 * Solana: N account reads, three ways.
 *
 *   serial    — N HTTP requests, N billable getAccountInfo
 *   batch     — 1 HTTP request,  N billable getAccountInfo  (latency win, no cost win)
 *   gMA       — ceil(N/100) HTTP, ceil(N/100) getMultipleAccounts  (the cost win)
 *
 * Also measures the payload difference between base64 and jsonParsed, and
 * between full data and a dataSlice — the levers that cut the *context* budget
 * rather than the credit budget.
 *
 *   node bench-solana.mjs [--n 60] [--runs 3] [--rpc <url>]
 */
import { RpcClient, repeat, chunk, fmt } from './lib/rpc.mjs'
import { costOf, PROVIDERS, VERIFIED_ON, BATCH_BILLING } from './lib/cost-model.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : []))

const N = Number(args.n ?? 60)
const RUNS = Number(args.runs ?? 3)
const RPC = args.rpc ?? process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'

// Real mainnet accounts — programs, mints, sysvars. All exist, so the
// correctness check compares real data rather than a wall of nulls.
const REAL = [
  'So11111111111111111111111111111111111111112',  // wSOL mint
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC mint
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT mint
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',  // RAY mint
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',   // mSOL mint
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // SPL Token program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',  // Associated Token program
  '11111111111111111111111111111111',              // System program
  'ComputeBudget111111111111111111111111111111',   // Compute Budget program
  'Stake11111111111111111111111111111111111111',   // Stake program
  'Vote111111111111111111111111111111111111111',   // Vote program
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',   // Metaplex Token Metadata
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',   // Jupiter v6
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',   // Orca Whirlpools
  'SysvarC1ock11111111111111111111111111111111',   // Clock sysvar
  'SysvarRent111111111111111111111111111111111',   // Rent sysvar
]

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58(bytes) {
  let num = 0n
  for (const b of bytes) num = num * 256n + BigInt(b)
  let s = ''
  while (num > 0n) { s = B58[Number(num % 58n)] + s; num /= 58n }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break }
  return s || '1'
}

/** Deterministic valid pubkeys that almost certainly do not exist (return null). */
function derivePubkey(i) {
  const bytes = new Uint8Array(32)
  let x = BigInt(i) * 0x9e3779b97f4a7c15n + 0x1234567n
  for (let j = 0; j < 32; j++) { bytes[j] = Number(x & 0xffn); x = (x * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n) }
  return base58(bytes)
}

const keys = Array.from({ length: N }, (_, i) => (i < REAL.length ? REAL[i] : derivePubkey(i)))

// Public endpoints rate-limit hard; keep concurrency low so `serial` measures
// latency rather than 429-backoff.
const client = new RpcClient(RPC, { concurrency: 3, maxRetries: 6, retryBaseMs: 500 })
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const OPTS = { encoding: 'base64', commitment: 'confirmed' }
const BATCH_CHUNK = Number(args['batch-chunk'] ?? 10)

const sig = (acc) => (acc == null ? 'null' : `${acc.owner}:${acc.lamports}`)

async function viaSerial() {
  const items = keys.map((k) => ({ method: 'getAccountInfo', params: [k, OPTS] }))
  return (await client.parallel(items)).map((r) => sig(r?.value ?? null))
}

async function viaBatch() {
  const out = []
  for (const c of chunk(keys, BATCH_CHUNK)) {
    const items = c.map((k) => ({ method: 'getAccountInfo', params: [k, OPTS] }))
    out.push(...(await client.batch(items)))
  }
  return out.map((r) => sig(r?.value ?? null))
}

async function viaGetMultipleAccounts() {
  const out = []
  for (const c of chunk(keys, 100)) {           // protocol max is 100 per call
    const r = await client.call('getMultipleAccounts', [c, OPTS])
    out.push(...r.value)
  }
  return out.map(sig)
}

console.log(`\nSolana account-read benchmark`)
console.log(`  endpoint : ${RPC}`)
console.log(`  reads    : ${N}   runs: ${RUNS} (median reported)`)
console.log(`  cost data verified ${VERIFIED_ON}\n`)

const baseline = await viaGetMultipleAccounts()
const live = baseline.filter((b) => b !== 'null').length
console.log(`  correctness baseline: ${live}/${N} accounts exist on-chain\n`)

const strategies = [
  { key: 'serial', label: `serial (${N} HTTP, ${N} getAccountInfo)`, fn: viaSerial, billedN: N, method: 'getAccountInfo', strategy: 'serial' },
  { key: 'batch', label: `JSON-RPC batch (${Math.ceil(N / BATCH_CHUNK)} HTTP, ${N} calls)`, fn: viaBatch, billedN: N, method: 'getAccountInfo', strategy: 'batch' },
  { key: 'gMA', label: `getMultipleAccounts (${Math.ceil(N / 100)} HTTP/call)`, fn: viaGetMultipleAccounts, billedN: Math.ceil(N / 100), method: 'getMultipleAccounts', strategy: 'aggregate' },
]

const results = []
for (const s of strategies) {
  await pause(1500)   // let the public endpoint's rate limiter recover between strategies
  client.reset()
  let out
  try { out = await s.fn() } catch (e) {
    console.log(`  ${s.label.padEnd(44)} unavailable — ${e.message.slice(0, 58)}`)
    console.log(`  ${''.padEnd(44)} (public mainnet-beta blocks batched getAccountInfo; use a keyed endpoint)`)
    continue
  }
  const matches = out.length === baseline.length && out.every((v, i) => v === baseline[i])
  client.reset()
  const t = await repeat(RUNS, s.fn)
  const throttled = client.retries
  results.push({ ...s, ms: t.median, matches, throttled })
  const flag = throttled > 0 ? `  [${throttled} rate-limit retries — timing inflated]` : ''
  console.log(`  ${s.label.padEnd(44)} ${fmt(t.median).padStart(6)} ms   ${matches ? 'results match ✓' : 'MISMATCH ✗'}${flag}`)
}

if (results.length) {
  const slowest = Math.max(...results.map((r) => r.ms))
  console.log(`\n  Latency`)
  for (const r of results) {
    const note = r.throttled > 0 ? '  ← throttled by public endpoint, not a clean latency number' : ''
    console.log(`    ${r.key.padEnd(10)} ${fmt(r.ms).padStart(6)} ms  (${(slowest / r.ms).toFixed(1)}x faster than slowest)${note}`)
  }

  const provs = ['alchemy', 'helius', 'ankr', 'quicknode', 'infura']
  console.log(`\n  Billable cost for ${N} account reads`)
  console.log(`    ${''.padEnd(10)} ${provs.map((p) => p.padStart(11)).join('')}`)
  for (const r of results) {
    const cells = provs.map((p) =>
      fmt(costOf({ chain: 'solana', method: r.method, n: N, provider: p, strategy: r.strategy, calls: r.billedN })).padStart(11))
    console.log(`    ${r.key.padEnd(10)} ${cells.join('')}`)
  }
  console.log(`    ${''.padEnd(10)} ${provs.map((p) => `(${PROVIDERS[p].unit})`.padStart(11)).join('')}`)

  const gma = results.find((r) => r.key === 'gMA')
  if (gma) {
    console.log(`\n  Savings, getMultipleAccounts vs serial`)
    for (const p of provs) {
      const a = costOf({ chain: 'solana', method: 'getAccountInfo', n: N, provider: p, strategy: 'serial' })
      const b = costOf({ chain: 'solana', method: 'getMultipleAccounts', n: N, provider: p, strategy: 'aggregate', calls: gma.billedN })
      console.log(`    ${p.padEnd(11)} ${fmt(a).padStart(8)} -> ${fmt(b).padStart(6)} ${PROVIDERS[p].unit.padEnd(8)} ${(a / b).toFixed(0)}x cheaper`)
    }
  }
  console.log(`\n  NOTE: Helius does not document how it bills JSON-RPC array batches.`)
  console.log(`        ${BATCH_BILLING.helius.notes}`)
}

// --- payload levers: these cut the agent context budget, not the credit budget ---
console.log(`\n  Payload size levers (same billable cost, very different byte counts)`)
const sample = REAL.slice(0, 8)
const variants = [
  { label: 'base64, full data', params: [sample, { encoding: 'base64', commitment: 'confirmed' }] },
  { label: 'jsonParsed, full data', params: [sample, { encoding: 'jsonParsed', commitment: 'confirmed' }] },
  { label: 'base64 + dataSlice(0,32)', params: [sample, { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 32 } }] },
]
let baseBytes = null
for (const v of variants) {
  client.reset()
  try {
    await client.call('getMultipleAccounts', v.params)
    const bytes = client.bytesDown
    baseBytes ??= bytes
    console.log(`    ${v.label.padEnd(28)} ${fmt(bytes).padStart(8)} bytes  (${(bytes / baseBytes).toFixed(2)}x baseline)`)
  } catch (e) {
    console.log(`    ${v.label.padEnd(28)} failed: ${e.message.slice(0, 60)}`)
  }
}
console.log(`    dataSlice is unavailable with jsonParsed encoding.\n`)
