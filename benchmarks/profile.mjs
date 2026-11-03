import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const port = Number(process.env.BENCH_PORT ?? 4174)
const base = `http://127.0.0.1:${port}`
const iterations = Number(process.env.BENCH_ITERATIONS ?? 15)
const memoryIterations = Number(process.env.MEMORY_ITERATIONS ?? 40)
const server = spawn(process.execPath, [join(here, 'server.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, BENCH_PORT: String(port) },
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(base)).ok) return
    } catch {}
    await sleep(50)
  }
  throw new Error('Benchmark server did not start')
}
function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}
function summarize(values) {
  return {
    medianMs: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    minMs: Number(Math.min(...values).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  }
}
async function measureNavigation(page, size, index) {
  return page.evaluate(
    ({ size, index }) =>
      new Promise((resolve, reject) => {
        const link = document.getElementById(size)
        if (!link) return reject(new Error(`Missing benchmark link: ${size}`))
        const timer = setTimeout(() => reject(new Error('Navigation benchmark timed out')), 15_000)
        const started = performance.now()
        document.addEventListener(
          'boost:after-swap',
          () => {
            clearTimeout(timer)
            resolve(performance.now() - started)
          },
          { once: true },
        )
        link.href = `/${size}?navigation=${index}`
        link.click()
      }),
    { size, index },
  )
}
async function measureStage(page, size, iterations) {
  return page.evaluate(
    async ({ size, iterations }) => {
      const requestSamples = []
      const bodyReadSamples = []
      const responseSamples = []
      let html = ''
      for (let index = 0; index < iterations; index++) {
        const started = performance.now()
        const response = await fetch(`/${size}?request=${index}`)
        const fetched = performance.now()
        const readResponse = window.__boostBenchReadResponseText
        if (typeof readResponse !== 'function') {
          throw new Error(`Response reader unavailable in stage benchmark: ${typeof readResponse}`)
        }
        html = await readResponse(response, 2 * 1024 * 1024)
        const completed = performance.now()
        requestSamples.push(fetched - started)
        bodyReadSamples.push(completed - fetched)
        responseSamples.push(completed - started)
      }

      const parseSamples = []
      const parsedDocuments = []
      for (let index = 0; index < iterations; index++) {
        const started = performance.now()
        const parsed = new DOMParser().parseFromString(html, 'text/html')
        parseSamples.push(performance.now() - started)
        parsedDocuments.push(parsed)
      }

      const securitySamples = []
      const securityCases = parsedDocuments.map((parsed) => ({
        target: document.createElement('div'),
        incoming: parsed.body,
        document: parsed,
        url: location.href,
        response: new Response(html),
        nonce: '',
      }))
      for (const context of securityCases) {
        const started = performance.now()
        window.__boostBenchUpdateDOM(context, { strategy: 'replace', swapHandler: () => {} }, html)
        securitySamples.push(performance.now() - started)
      }

      const parsed = parsedDocuments.at(-1)
      const source = parsed.querySelector('main')
      const target = document.createElement('div')
      document.body.append(target)
      const fragments = Array.from({ length: iterations }, () => {
        const fragment = document.createDocumentFragment()
        for (const child of Array.from(source.children)) fragment.append(child.cloneNode(true))
        return fragment
      })
      const domSamples = []
      for (const fragment of fragments) {
        const started = performance.now()
        target.replaceChildren(fragment)
        domSamples.push(performance.now() - started)
      }

      target.remove()
      return {
        requestFetch: requestSamples,
        responseBodyRead: bodyReadSamples,
        requestProcessing: responseSamples,
        htmlParsing: parseSamples,
        securityFiltering: securitySamples,
        domReplacement: domSamples,
        responseBytes: new TextEncoder().encode(html).byteLength,
        elementCount: parsed.querySelectorAll('*').length,
      }
    },
    { size, iterations },
  )
}
async function measureEventDelegation(page, count = 10_000) {
  return page.evaluate((count) => {
    const target = document.getElementById('event-target')
    if (!target) throw new Error('Missing event benchmark target')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    const started = performance.now()
    for (let index = 0; index < count; index++) target.dispatchEvent(event)
    return performance.now() - started
  }, count)
}
async function measureMemory(page, count) {
  const client = await page.context().newCDPSession(page)
  await client.send('HeapProfiler.enable')
  const collect = async () => {
    await client.send('HeapProfiler.collectGarbage')
    const usage = await client.send('Runtime.getHeapUsage')
    return usage.usedSize
  }
  const navigateBatch = async (prefix, iterations) =>
    page.evaluate(
      async ({ prefix, iterations }) => {
        for (let index = 0; index < iterations; index++) {
          const ok = await window.boostHtml.navigate(`/large?${prefix}=${index}`, {
            push: 'replace',
          })
          if (!ok) throw new Error(`Memory navigation failed: ${prefix} ${index}`)
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      },
      { prefix, iterations },
    )

  await navigateBatch('memory-warmup', 10)
  const samples = [await collect()]
  for (let cycle = 0; cycle < 5; cycle++) {
    await navigateBatch(`memory-${cycle}`, count)
    samples.push(await collect())
  }
  await client.detach()
  return {
    samplesBytes: samples,
    deltaPerCycleBytes: samples.slice(1).map((value, index) => value - samples[index]),
    totalDeltaBytes: samples.at(-1) - samples[0],
    cycles: 5,
    navigationsPerCycle: count,
    heapMeasurement: 'CDP HeapProfiler.collectGarbage + Runtime.getHeapUsage usedSize',
  }
}

let browser
try {
  const esbuild = join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild',
  )
  const readerBuild = spawnSync(
    esbuild,
    [
      join(here, 'response-reader.ts'),
      '--bundle',
      '--format=iife',
      `--outfile=${join(here, '.response-reader.js')}`,
    ],
    { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' },
  )
  if (readerBuild.status !== 0) {
    throw new Error(
      readerBuild.stderr ||
        readerBuild.error?.message ||
        'Failed to build response benchmark helper',
    )
  }
  await waitForServer()
  browser = await chromium.launch()
  const page = await browser.newPage()
  const responseReaderBundle = await readFile(join(here, '.response-reader.js'), 'utf8')
  await page.addInitScript({ content: responseReaderBundle })
  await page.goto(base)
  const readerAvailable = await page.evaluate(
    () => typeof window.__boostBenchReadResponseText === 'function',
  )
  if (!readerAvailable) throw new Error('Failed to install the response-reader benchmark helper')
  await page.evaluate(() => {
    const target = document.createElement('div')
    target.id = 'event-target'
    target.setAttribute('aria-hidden', 'true')
    document.body.append(target)
  })

  const results = {}
  for (const size of ['small', 'medium', 'large']) {
    const stage = await measureStage(page, size, iterations)
    const navigation = []
    for (let index = 0; index < 3; index++) {
      await page.goto(base)
      await measureNavigation(page, size, `warmup-${index}`)
    }
    for (let index = 0; index < iterations; index++) {
      await page.goto(base)
      navigation.push(await measureNavigation(page, size, index))
    }
    results[size] = {
      elements: stage.elementCount,
      responseBytes: stage.responseBytes,
      navigationClickToAfterSwap: summarize(navigation),
      requestFetch: summarize(stage.requestFetch),
      responseBodyRead: summarize(stage.responseBodyRead),
      requestProcessing: summarize(stage.requestProcessing),
      domParser: summarize(stage.htmlParsing),
      securityFiltering: summarize(stage.securityFiltering),
      nativeDOMReplacement: summarize(stage.domReplacement),
    }
  }

  await page.goto(base)
  await page.evaluate(() => {
    const target = document.createElement('div')
    target.id = 'event-target'
    document.body.append(target)
  })
  const eventSamples = []
  for (let index = 0; index < 7; index++) eventSamples.push(await measureEventDelegation(page))
  const memory = await measureMemory(page, memoryIterations)

  const bundleSizes = {}
  for (const file of [
    'dist/core.js',
    'dist/index.js',
    'dist/core.global.js',
    'dist/index.global.js',
  ]) {
    const contents = await readFile(join(root, file))
    bundleSizes[file] = {
      rawBytes: contents.byteLength,
      gzipBytes: gzipSync(contents).byteLength,
    }
  }

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
      userAgent: await page.evaluate(() => navigator.userAgent),
      hardwareConcurrency: await page.evaluate(() => navigator.hardwareConcurrency),
      iterations,
      memoryIterations,
      memoryMeasurement:
        'CDP V8 heap usedSize after forced garbage collection; not total process/RSS',
    },
    fixtures: {
      small: '10 generated article sections; 30+ document elements (target: 10–50)',
      medium: '100 generated article sections; 300+ document elements (target: 100–500)',
      large: '1,000 generated article sections; 3,000+ document elements (target: 1,000–5,000)',
    },
    results: {
      navigation: results,
      eventDelegation: {
        eventsPerSample: 10_000,
        samples: 7,
        totalDispatch: summarize(eventSamples),
        microsecondsPerEvent: Number(((percentile(eventSamples, 0.5) * 1000) / 10_000).toFixed(3)),
      },
      repeatedNavigationMemory: memory,
      bundleSizes,
    },
  }

  console.log(JSON.stringify(report, null, 2))
  await mkdir(join(here, 'results'), { recursive: true })
  const output = process.env.BENCH_OUTPUT ?? join(here, 'results', 'production-baseline.json')
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nSaved benchmark report: ${output}`)
} finally {
  if (browser) await browser.close().catch(() => {})
  server.kill()
  await unlink(join(here, '.response-reader.js')).catch(() => {})
}
