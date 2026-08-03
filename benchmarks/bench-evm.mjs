#!/usr/bin/env node
/**
 * EVM: N ERC-20 balance reads, three ways.
 *
 *   serial     — N HTTP requests, N billable eth_call
 *   batch      — 1 HTTP request,  N billable eth_call   (latency win, no cost win)
 *   multicall3 — 1 HTTP request,  1 billable eth_call   (the actual cost win)
 *
 * Results are cross-checked: multicall3 output must equal serial output, or the
 * benchmark fails. A fast wrong answer is not an optimization.
 *
 *   node bench-evm.mjs [--n 50] [--runs 3] [--rpc <url>]
 */
import { RpcClient, repeat, chunk, fmt } from './lib/rpc.mjs'
import {
  MULTICALL3, encodeBalanceOf, encodeAggregate3, decodeAggregate3,
  toBigInt, deriveAddress,
} from './lib/abi.mjs'
import { costOf, PROVIDERS, BATCH_BILLING, VERIFIED_ON } from './lib/cost-model.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : []))

const N = Number(args.n ?? 50)
const RUNS = Number(args.runs ?? 3)
const RPC = args.rpc ?? process.env.EVM_RPC_URL ?? 'https://ethereum-rpc.publicnode.com'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

// Real mainnet addresses with non-zero USDC, so the correctness check is meaningful.
const REAL_HOLDERS = [
  '0x28C6c06298d514Db089934071355E5743bf21d60', // Binance 14
  '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', // Binance 16
  '0xF977814e90dA44bFA03b6295A0616a897441aceC', // Binance 8
  '0x5041ed759Dd4aFc3a72b8192C143F72f4724081A', // OKX
  '0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43', // Coinbase 10
  '0x0A59649758aa4d66E25f08Dd01271e891fe52199', // Maker PSM
  '0xcEe284F754E854890e311e3280b767F80797180d', // Arbitrum bridge
  '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf', // Polygon bridge
]

const holders = Array.from({ length: N }, (_, i) =>
  i < REAL_HOLDERS.length ? REAL_HOLDERS[i] : deriveAddress(i))

const client = new RpcClient(RPC, { concurrency: 10 })

const callItems = holders.map((h) => ({
  method: 'eth_call',
  params: [{ to: USDC, data: encodeBalanceOf(h) }, 'latest'],
}))

async function viaSerial() {
  return (await client.parallel(callItems)).map(toBigInt)
}

async function viaBatch() {
  // Chunked to stay under provider batch caps (Ankr public = 10, Alchemy = 1000).
  const out = []
  for (const c of chunk(callItems, 100)) out.push(...(await client.batch(c)))
  return out.map(toBigInt)
}

async function viaMulticall3() {
  const out = []
  // 500 reads/call keeps calldata well inside Alchemy's 550M eth_call gas cap.
  for (const group of chunk(holders, 500)) {
    const data = encodeAggregate3(
      group.map((h) => ({ target: USDC, allowFailure: true, callData: encodeBalanceOf(h) })))
    const raw = await client.call('eth_call', [{ to: MULTICALL3, data }, 'latest'])
    out.push(...decodeAggregate3(raw).map((r) => (r.success ? toBigInt(r.returnData) : null)))
  }
  return out
}

const strategies = [
  { key: 'serial', label: `serial (${N} HTTP, ${N} eth_call)`, fn: viaSerial, httpN: N, billedN: N, strategy: 'serial' },
  { key: 'batch', label: `JSON-RPC batch (1 HTTP, ${N} eth_call)`, fn: viaBatch, httpN: Math.ceil(N / 100), billedN: N, strategy: 'batch' },
  { key: 'multicall3', label: `Multicall3 (1 HTTP, 1 eth_call)`, fn: viaMulticall3, httpN: Math.ceil(N / 500), billedN: Math.ceil(N / 500), strategy: 'aggregate' },
]

console.log(`\nEVM balance-read benchmark`)
console.log(`  endpoint : ${RPC}`)
console.log(`  token    : USDC`)
console.log(`  reads    : ${N}   runs: ${RUNS} (median reported)`)
console.log(`  cost data verified ${VERIFIED_ON}\n`)

const baseline = await viaSerial()
const nonZero = baseline.filter((b) => b > 0n).length
console.log(`  correctness baseline: ${nonZero}/${N} holders with non-zero balance\n`)

const results = []
for (const s of strategies) {
  client.reset()
  let out
  try {
    out = await s.fn()
  } catch (e) {
    console.log(`  ${s.label.padEnd(42)} FAILED: ${e.message}`)
    continue
  }
  const matches = out.length === baseline.length &&
    out.every((v, i) => (v ?? 0n) === baseline[i])
  const t = await repeat(RUNS, s.fn)
  results.push({ ...s, ms: t.median, min: t.min, max: t.max, matches, bytes: client.bytesDown })
  console.log(
    `  ${s.label.padEnd(42)} ${fmt(t.median, 0).padStart(6)} ms   ` +
    `${matches ? 'results match ✓' : 'MISMATCH ✗'}`)
}

const slowest = Math.max(...results.map((r) => r.ms))
console.log(`\n  Latency`)
for (const r of results) {
  console.log(`    ${r.key.padEnd(12)} ${fmt(r.ms).padStart(6)} ms  (${(slowest / r.ms).toFixed(1)}x faster than slowest)`)
}

console.log(`\n  Billable cost for ${N} reads`)
const provs = ['alchemy', 'infura', 'ankr', 'quicknode']
console.log(`    ${''.padEnd(12)} ${provs.map((p) => p.padStart(12)).join('')}`)
for (const r of results) {
  const cells = provs.map((p) => {
    const c = costOf({
      chain: 'evm', method: 'eth_call', n: N, provider: p,
      strategy: r.strategy, calls: r.billedN,
    })
    return fmt(c).padStart(12)
  })
  console.log(`    ${r.key.padEnd(12)} ${cells.join('')}`)
}
console.log(`    ${''.padEnd(12)} ${provs.map((p) => `(${PROVIDERS[p].unit})`.padStart(12)).join('')}`)

const mc = results.find((r) => r.key === 'multicall3')
const se = results.find((r) => r.key === 'serial')
if (mc && se) {
  console.log(`\n  Savings, multicall3 vs serial`)
  for (const p of provs) {
    const a = costOf({ chain: 'evm', method: 'eth_call', n: N, provider: p, strategy: 'serial' })
    const b = costOf({ chain: 'evm', method: 'eth_call', n: N, provider: p, strategy: 'aggregate', calls: mc.billedN })
    console.log(`    ${p.padEnd(12)} ${fmt(a).padStart(9)} -> ${fmt(b).padStart(7)} ${PROVIDERS[p].unit.padEnd(8)} ${(a / b).toFixed(0)}x cheaper`)
  }
  console.log(`\n  Batching vs serial (the point most people get wrong)`)
  for (const p of provs) {
    const a = costOf({ chain: 'evm', method: 'eth_call', n: N, provider: p, strategy: 'serial' })
    const b = costOf({ chain: 'evm', method: 'eth_call', n: N, provider: p, strategy: 'batch' })
    const delta = b - a
    const verdict = delta > 0 ? `${fmt(delta)} MORE than serial` : delta === 0 ? 'identical to serial' : 'cheaper'
    console.log(`    ${p.padEnd(12)} ${fmt(b).padStart(9)} ${PROVIDERS[p].unit.padEnd(8)} ${verdict}`)
  }
  console.log(`\n  Infura bills the batch envelope as an extra request:`)
  console.log(`    "${BATCH_BILLING.infura.quote.slice(0, 96)}..."`)
}
console.log()
