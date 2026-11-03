import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const port = Number(process.env.BENCH_PORT ?? 4175)
const base = `http://127.0.0.1:${port}`
const iterations = Number(process.env.PREFETCH_ITERATIONS ?? 10)
const artificialLatencyMs = Number(process.env.PREFETCH_LATENCY_MS ?? 120)
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
})

async function runScenario(browser, enabled) {
  const page = await browser.newPage()
  await page.route('**/large*', async (route) => {
    await sleep(artificialLatencyMs)
    await route.continue()
  })
  const latencies = []
  let requestCount = 0
  await fetch(`${base}/__metrics/reset`)
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/large') requestCount++
  })

  for (let index = 0; index < iterations; index++) {
    await page.goto(`${base}${enabled ? '?prefetch=1' : ''}`)
    await page.evaluate((index) => {
      const link = document.getElementById('large')
      if (!link) throw new Error('Missing benchmark navigation link')
      link.setAttribute('href', `/large?run=${index}`)
    }, index)

    if (enabled) {
      await page.locator('#large').dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 })
      await sleep(40)
    }

    const duration = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Navigation benchmark timed out')),
            10_000,
          )
          const started = performance.now()
          document.addEventListener(
            'boost:after-swap',
            () => {
              clearTimeout(timer)
              resolve(performance.now() - started)
            },
            { once: true },
          )
          document.getElementById('large')?.click()
        }),
    )
    latencies.push(duration)
  }

  const metrics = await (await fetch(`${base}/__metrics`)).json()
  await page.close()
  return {
    navigationLatency: summarize(latencies),
    requestCount,
    serverRequestCount: metrics.large.requests,
    responseBytes: metrics.large.bytes,
    iterations,
  }
}

async function measureUnusedPrefetch(browser) {
  const page = await browser.newPage()
  await page.goto(`${base}?prefetch=1`)
  let requests = 0
  await fetch(`${base}/__metrics/reset`)
  page.on('request', (request) => {
    if (['/small', '/medium'].includes(new URL(request.url()).pathname)) requests++
  })
  await page.locator('#small').dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 })
  await page.locator('#medium').dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 })
  await page.waitForTimeout(500)
  const metrics = await (await fetch(`${base}/__metrics`)).json()
  await page.close()
  return {
    unusedPrefetchRequests: requests,
    serverRequestCount: metrics.small.requests + metrics.medium.requests,
    unusedPrefetchResponseBytes: metrics.small.bytes + metrics.medium.bytes,
  }
}

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
  const baseline = await runScenario(browser, false)
  const prefetch = await runScenario(browser, true)
  const unused = await measureUnusedPrefetch(browser)
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
      userAgent: await browser.newPage().then(async (page) => {
        await page.goto(base)
        const ua = await page.evaluate(() => navigator.userAgent)
        await page.close()
        return ua
      }),
      iterations,
      artificialLatencyMs,
      prefetchLeadTimeMs: 40,
    },
    scenarios: { baseline, pointerdownPrefetch: prefetch, unusedPrefetch: unused },
    note: 'Local loopback benchmark with deterministic server-side latency injection; not a substitute for field RUM or mobile-network measurements.',
  }
  console.log(JSON.stringify(report, null, 2))
  await mkdir(join(here, 'results'), { recursive: true })
  const output = process.env.PREFETCH_BENCH_OUTPUT ?? join(here, 'results', 'prefetch.json')
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nSaved prefetch benchmark report: ${output}`)
} finally {
  if (browser) await browser.close().catch(() => {})
  server.kill()
}
