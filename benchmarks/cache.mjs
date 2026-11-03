import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const port = Number(process.env.CACHE_BENCH_PORT ?? 4176)
const base = `http://127.0.0.1:${port}`
const iterations = Number(process.env.CACHE_BENCH_ITERATIONS ?? 12)
const memoryEntries = Number(process.env.CACHE_MEMORY_ENTRIES ?? 25)
const latencyMs = Number(process.env.CACHE_BENCH_LATENCY_MS ?? 50)
const server = spawn(process.execPath, [join(here, 'server.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, BENCH_PORT: String(port) },
})
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
}
const summarize = (values) => ({
  medianMs: Number(percentile(values, 0.5).toFixed(2)),
  p95Ms: Number(percentile(values, 0.95).toFixed(2)),
  minMs: Number(Math.min(...values).toFixed(2)),
  maxMs: Number(Math.max(...values).toFixed(2)),
})

let browser
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(base)).ok) break
    } catch {}
    await sleep(50)
    if (attempt === 99) throw new Error('Benchmark server did not start')
  }
  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.route('**/large*', async (route) => {
    await sleep(latencyMs)
    await route.continue()
  })
  await page.goto(`${base}?cache=1`)
  await page.waitForFunction(() => Boolean(window.boostHtml?.navigate))
  await fetch(`${base}/__metrics/reset`)

  const latency = await page.evaluate(async (iterations) => {
    const cold = []
    const hit = []
    for (let index = 0; index < iterations; index++) {
      const url = `/large?cache-latency=${index}`
      let started = performance.now()
      if (!(await window.boostHtml.navigate(url, { push: 'replace' }))) {
        throw new Error(`Cold navigation failed for ${url}`)
      }
      cold.push(performance.now() - started)
      started = performance.now()
      if (!(await window.boostHtml.navigate(url, { push: 'replace' }))) {
        throw new Error(`Cached navigation failed for ${url}`)
      }
      hit.push(performance.now() - started)
    }
    return { cold, hit }
  }, iterations)

  const metrics = await (await fetch(`${base}/__metrics`)).json()
  const client = await page.context().newCDPSession(page)
  await client.send('HeapProfiler.enable')
  const collectHeap = async () => {
    await client.send('HeapProfiler.collectGarbage')
    return (await client.send('Runtime.getHeapUsage')).usedSize
  }
  await page.evaluate(() => {
    window.boostHtml.clearCache()
  })
  await page.waitForTimeout(50)
  const heapBefore = await collectHeap()
  await page.evaluate(async (count) => {
    for (let index = 0; index < count; index++) {
      const ok = await window.boostHtml.navigate(`/large?cache-memory=${index}`, {
        push: 'replace',
      })
      if (!ok) throw new Error(`Memory cache navigation failed: ${index}`)
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, memoryEntries)
  const heapAfterFill = await collectHeap()
  await page.evaluate(() => {
    window.boostHtml.clearCache()
  })
  await page.waitForTimeout(50)
  const heapAfterClear = await collectHeap()
  await client.detach()

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      release: os.release(),
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCpus: os.cpus().length,
      node: process.version,
      playwright: JSON.parse(
        await readFile(join(root, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8'),
      ).version,
      chromium: browser.version(),
      iterations,
      memoryEntriesRequested: memoryEntries,
      maxCacheEntries: 20,
      maxAgeMs: 30_000,
      injectedLatencyMs: latencyMs,
    },
    navigation: {
      cold: summarize(latency.cold),
      cacheHit: summarize(latency.hit),
      medianSavedMs: Number(
        (percentile(latency.cold, 0.5) - percentile(latency.hit, 0.5)).toFixed(2),
      ),
      medianImprovementPercent: Number(
        ((1 - percentile(latency.hit, 0.5) / percentile(latency.cold, 0.5)) * 100).toFixed(1),
      ),
      serverRequests: metrics.large.requests,
      responseBytes: metrics.large.bytes,
      expectedRequestsWithoutCache: iterations * 2,
    },
    memory: {
      heapBeforeBytes: heapBefore,
      heapAfterFillBytes: heapAfterFill,
      heapAfterClearBytes: heapAfterClear,
      heapGrowthAfterFillBytes: heapAfterFill - heapBefore,
      heapRetainedAfterClearBytes: heapAfterClear - heapBefore,
      note: 'CDP V8 heap only; browser-native Response body storage and process RSS are not included.',
    },
    note: 'Local loopback Chromium benchmark with injected latency and explicitly public HTML responses. Results are synthetic, not field telemetry.',
  }
  console.log(JSON.stringify(report, null, 2))
  await mkdir(join(here, 'results'), { recursive: true })
  const output = process.env.CACHE_BENCH_OUTPUT ?? join(here, 'results', 'cache.json')
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nSaved navigation cache benchmark: ${output}`)
  await page.close()
} finally {
  if (browser) await browser.close().catch(() => {})
  server.kill()
}
