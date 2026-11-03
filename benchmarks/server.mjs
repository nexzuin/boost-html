import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const port = Number(process.env.BENCH_PORT ?? 4174)
const counts = { small: 10, medium: 100, large: 1_000 }
const metrics = Object.fromEntries(
  Object.keys(counts).map((name) => [name, { requests: 0, bytes: 0 }]),
)

function page(title, content) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title} · boost-html benchmark</title>
    <script>
      window.boostHtmlConfig = {
        progress: false,
        executeScripts: false,
        prefetch: new URLSearchParams(location.search).has('prefetch')
          ? { enabled: true, strategy: 'pointerdown', maxConcurrent: 2 }
          : { enabled: false },
        cache: new URLSearchParams(location.search).has('cache')
          ? { enabled: true, maxEntries: 20, maxAge: 30000 }
          : { enabled: false },
      }
    </script>
    <script defer src="/boost-html.js"></script>
  </head>
  <body data-boost="true">
    <nav>
      <a id="home" href="/">Home</a>
      <a id="small" href="/small">Small</a>
      <a id="medium" href="/medium">Medium</a>
      <a id="large" href="/large">Large</a>
    </nav>
    ${content}
  </body>
</html>`
}

function fixture(size) {
  const count = counts[size]
  const items = Array.from(
    { length: count },
    (_, index) =>
      `<article><h2>Item ${index}</h2><p>Benchmark paragraph ${index} for ${size} documents.</p></article>`,
  ).join('')

  return page(size, `<main><h1>${size}</h1>${items}</main>`)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/__metrics/reset') {
    for (const metric of Object.values(metrics)) {
      metric.requests = 0
      metric.bytes = 0
    }
    res.writeHead(204)
    res.end()
    return
  }

  if (url.pathname === '/__metrics') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(metrics))
    return
  }

  if (url.pathname === '/boost-html.js') {
    try {
      const bundle = await readFile(join(root, 'dist', 'index.global.js'))
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(bundle)
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('Run `npm run build` before benchmarking.')
    }
    return
  }

  const size = url.pathname.slice(1)
  if (size === '') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page('bench', '<main><h1>bench</h1></main>'))
    return
  }

  if (size in counts) {
    const body = fixture(size)
    metrics[size].requests++
    metrics[size].bytes += Buffer.byteLength(body)
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=30',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('Not found')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`benchmark server listening on http://127.0.0.1:${port}`)
})
