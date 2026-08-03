/**
 * Timed JSON-RPC client with request accounting.
 * Counts HTTP round-trips and billable method invocations separately —
 * that distinction is the whole point of these benchmarks.
 */

export class RpcClient {
  constructor(url, { concurrency = 10, label = 'rpc', maxRetries = 5, retryBaseMs = 400 } = {}) {
    this.url = url
    this.concurrency = concurrency
    this.label = label
    this.maxRetries = maxRetries
    this.retryBaseMs = retryBaseMs
    this.reset()
  }

  reset() {
    this.httpRequests = 0
    this.methodCalls = 0
    this.bytesDown = 0
    this.errors = 0
    this.retries = 0
  }

  async #post(body, attempt = 0) {
    this.httpRequests++
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    this.bytesDown += text.length

    // Public endpoints throttle aggressively. Back off rather than reporting a
    // rate limit as a latency result — that would make `serial` look artificially
    // slow and overstate the optimization.
    const throttled = res.status === 429 || text.includes('"code": 429') || text.includes('"code":429')
    if (throttled && attempt < this.maxRetries) {
      const wait = this.retryBaseMs * 2 ** attempt + Math.floor(Math.random() * 100)
      this.retries++
      await new Promise((r) => setTimeout(r, wait))
      return this.#post(body, attempt + 1)
    }

    if (!res.ok) {
      this.errors++
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`)
    }
    return JSON.parse(text)
  }

  /** One method call, one HTTP request. */
  async call(method, params = []) {
    this.methodCalls++
    const out = await this.#post({ jsonrpc: '2.0', id: 1, method, params })
    if (out.error) {
      this.errors++
      throw new Error(`${method}: ${JSON.stringify(out.error).slice(0, 160)}`)
    }
    return out.result
  }

  /** N method calls in ONE HTTP request (JSON-RPC array batch). */
  async batch(items) {
    this.methodCalls += items.length
    const payload = items.map((it, i) => ({
      jsonrpc: '2.0',
      id: i,
      method: it.method,
      params: it.params ?? [],
    }))
    const out = await this.#post(payload)
    if (!Array.isArray(out)) throw new Error(`batch: non-array response`)
    return out.sort((a, b) => a.id - b.id).map((r) => {
      if (r.error) this.errors++
      return r.result ?? null
    })
  }

  /** N method calls as N HTTP requests, bounded concurrency. */
  async parallel(items) {
    const results = new Array(items.length)
    let cursor = 0
    const workers = Array.from({ length: Math.min(this.concurrency, items.length) }, async () => {
      while (true) {
        const i = cursor++
        if (i >= items.length) return
        try {
          results[i] = await this.call(items[i].method, items[i].params ?? [])
        } catch (e) {
          results[i] = null
        }
      }
    })
    await Promise.all(workers)
    return results
  }
}

export async function timed(label, fn) {
  const t0 = performance.now()
  const value = await fn()
  const ms = performance.now() - t0
  return { label, ms, value }
}

/** Median of N runs — less noisy than a single sample on public endpoints. */
export async function repeat(runs, fn) {
  const samples = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    await fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  return {
    median: samples[Math.floor(samples.length / 2)],
    min: samples[0],
    max: samples[samples.length - 1],
    samples,
  }
}

export const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size))

export const fmt = (n, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d })
