import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.BENCH_PORT ?? 4174)
const base = `http://127.0.0.1:${port}`
const iterations = Number(process.env.BENCH_ITERATIONS ?? 20)
const warmup = 3

const server = spawn(process.execPath, [join(here, 'server.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, BENCH_PORT: String(port) },
})

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(base)
      if (response.ok) return
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Benchmark server did not start')
}

function percentile(values, ratio) {
  if (values.length === 0) return Number.NaN
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)
  return values[index]
}

async function measure(page, size) {
  return page.evaluate(
    (targetId) =>
      new Promise((resolve, reject) => {
        const link = document.getElementById(targetId)
        if (!link) {
          reject(new Error(`Missing link ${targetId}`))
          return
        }

        const start = performance.now()
        const timer = setTimeout(() => reject(new Error('Navigation timed out')), 15_000)
        document.addEventListener(
          'boost:after-swap',
          () => {
            clearTimeout(timer)
            resolve(performance.now() - start)
          },
          { once: true },
        )
        link.click()
      }),
    size,
  )
}

try {
  await waitForServer()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const results = {}

  for (const size of ['small', 'medium', 'large']) {
    for (let index = 0; index < warmup; index++) {
      await page.goto(base)
      await measure(page, size)
      await page.waitForSelector('h1')
    }

    const samples = []
    for (let index = 0; index < iterations; index++) {
      await page.goto(base)
      const duration = await measure(page, size)
      await page.waitForFunction(
        (expected) => document.querySelector('h1')?.textContent === expected,
        size,
      )
      samples.push(duration)
    }

    samples.sort((a, b) => a - b)
    results[size] = {
      median: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      min: samples[0],
      max: samples[samples.length - 1],
    }
  }

  console.log(`\nboost-html benchmark (${iterations} iterations, Chromium)`)
  console.log('navigation click → boost:after-swap, milliseconds')
  for (const [size, stats] of Object.entries(results)) {
    console.log(
      `${size.padEnd(7)} median ${stats.median.toFixed(2)}  p95 ${stats.p95.toFixed(2)}  min ${stats.min.toFixed(2)}  max ${stats.max.toFixed(2)}`,
    )
  }

  await browser.close()
} finally {
  server.kill()
}
