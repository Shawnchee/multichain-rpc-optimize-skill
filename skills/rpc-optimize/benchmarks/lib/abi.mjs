/**
 * Minimal hand-rolled ABI encoding — just enough for the benchmarks.
 * Deliberately dependency-free so `node bench-*.mjs` works with no install step.
 */

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

// bytes4(keccak256("balanceOf(address)"))
export const SELECTOR_BALANCE_OF = '70a08231'
// bytes4(keccak256("aggregate3((address,bool,bytes)[])"))
export const SELECTOR_AGGREGATE3 = '82ad56cb'

const strip = (h) => (h.startsWith('0x') ? h.slice(2) : h)
const word = (n) => BigInt(n).toString(16).padStart(64, '0')
const padAddr = (a) => strip(a).toLowerCase().padStart(64, '0')
const padRight = (h) => h + '0'.repeat((64 - (h.length % 64)) % 64)

/** encode balanceOf(address) */
export function encodeBalanceOf(holder) {
  return '0x' + SELECTOR_BALANCE_OF + padAddr(holder)
}

/**
 * encode aggregate3((address target, bool allowFailure, bytes callData)[])
 *
 * Layout: the array is dynamic and its elements are dynamic (they contain
 * `bytes`), so we emit a head of element offsets followed by each encoded tuple.
 */
export function encodeAggregate3(calls) {
  const tuples = calls.map(({ target, allowFailure = true, callData }) => {
    const data = strip(callData)
    return (
      padAddr(target) +           // address
      word(allowFailure ? 1 : 0) + // bool
      word(0x60) +                 // offset to bytes, relative to tuple start
      word(data.length / 2) +      // bytes length
      padRight(data)               // bytes payload
    )
  })

  // Offsets are relative to the start of the element section (after the length word).
  let cursor = tuples.length * 32
  const heads = []
  for (const t of tuples) {
    heads.push(word(cursor))
    cursor += t.length / 2
  }

  return (
    '0x' +
    SELECTOR_AGGREGATE3 +
    word(0x20) +          // offset to the array
    word(tuples.length) + // array length
    heads.join('') +
    tuples.join('')
  )
}

/** decode Result[] = (bool success, bytes returnData)[] */
export function decodeAggregate3(hex) {
  const d = strip(hex)
  const at = (i) => d.slice(i * 2, i * 2 + 64)
  const num = (i) => parseInt(at(i), 16)

  const arrStart = num(0)                 // offset to array
  const len = num(arrStart)               // array length
  const elemBase = arrStart + 32

  const out = []
  for (let i = 0; i < len; i++) {
    const elem = elemBase + num(elemBase + i * 32)
    const success = num(elem) === 1
    const dataOff = elem + num(elem + 32)
    const dataLen = num(dataOff)
    out.push({
      success,
      returnData: '0x' + d.slice((dataOff + 32) * 2, (dataOff + 32 + dataLen) * 2),
    })
  }
  return out
}

export const toBigInt = (hex) => (!hex || hex === '0x' ? 0n : BigInt(hex))

/**
 * Deterministic pseudo-addresses for scaling a benchmark past the curated
 * real-holder list. These are valid addresses that almost certainly hold zero —
 * the node still performs a full SLOAD, so per-call work is representative.
 */
export function deriveAddress(i) {
  const seed = (BigInt(i) * 0x9e3779b97f4a7c15n) & ((1n << 160n) - 1n)
  return '0x' + seed.toString(16).padStart(40, '0')
}
