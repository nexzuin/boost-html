import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const port = Number(process.env.PORT ?? 3000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function layout({ req, title, content }) {
  const boosted = req.headers['hx-request'] === 'true'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · boost-html demo</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0 auto; max-width: 46rem; padding: 2rem 1.25rem 6rem; line-height: 1.6; }
      nav { display: flex; flex-wrap: wrap; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
      nav a { color: inherit; }
      form { display: flex; gap: 0.5rem; align-items: end; margin: 1.5rem 0; }
      label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
      input { padding: 0.45rem 0.6rem; font: inherit; }
      button { padding: 0.5rem 0.9rem; font: inherit; cursor: pointer; }
      code { background: color-mix(in srgb, currentColor 10%, transparent); padding: 0.1rem 0.3rem; border-radius: 4px; }
      footer { margin-top: 3rem; font-size: 0.85rem; opacity: 0.75; }
      .badge { display: inline-block; font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: color-mix(in srgb, currentColor 12%, transparent); }
    </style>
    <script>
      window.boostHtmlConfig = {
        progress: { showSpinner: true, trickleSpeed: 120 },
        // Script re-execution is opt-in. This demo enables it explicitly.
        executeScripts: true,
      }
    </script>
    <script defer src="/boost-html.js"></script>
  </head>
  <body data-boost="true">
    <nav>
      <a href="/">Home</a>
      <a href="/about">About</a>
      <a href="/docs#install">Docs (hash)</a>
      <a href="/slow">Slow page</a>
      <a href="/broken">Broken page</a>
      <a href="/scripts">Scripts</a>
    </nav>
    ${content}
    <footer>
      <span class="badge">${boosted ? 'boosted request' : 'full page load'}</span>
      · history entries: <span id="history-length">—</span>
      <script>
        document.getElementById('history-length').textContent = String(window.history.length)
      </script>
    </footer>
  </body>
</html>`
}

const home = (req) =>
  layout({
    req,
    title: 'Home',
    content: `
      <h1>boost-html</h1>
      <p>This demo is served by a tiny Node server. Every link and form inside
      <code>body[data-boost="true"]</code> is fetched with <code>fetch()</code>,
      then the body is swapped without a full page reload.</p>

      <form action="/search" method="get">
        <label>GET search <input name="q" value="boost" /></label>
        <button>Search</button>
      </form>

      <form action="/greet" method="post">
        <label>POST form <input name="name" value="Ada" /></label>
        <button>Say hello</button>
      </form>

      <ul>
        <li><a href="/slow">A slow route (watch the progress bar)</a></li>
        <li><a href="/broken">A 500 response (falls back to a full page load)</a></li>
        <li><a href="/about" data-boost="false">Opt out with data-boost="false"</a></li>
        <li><a href="https://github.com/bigskysoftware/htmx">External link (not boosted)</a></li>
      </ul>

      ${'<p>Filler content so the page can scroll. Scroll down, navigate, then use the back button to see the scroll position restored.</p>'.repeat(30)}
    `,
  })

const about = (req) =>
  layout({
    req,
    title: 'About',
    content: `
      <h1>About</h1>
      <p>boost-html is a small progressive-enhancement library inspired by
      <code>hx-boost</code> from htmx. Without JavaScript the links keep working
      as normal anchors, because they are plain <code>&lt;a href&gt;</code> tags.</p>
      <p>Try the back and forward buttons — navigation is fetched and swapped,
      and the scroll position of each history entry is restored.</p>
    `,
  })

const docs = (req) =>
  layout({
    req,
    title: 'Docs',
    content: `
      <h1>Docs</h1>
      <h2 id="install">Install</h2>
      <p><code>npm install boost-html</code>, then <code>import 'boost-html'</code>.
      Add <code>data-boost="true"</code> to the container you want to boost.</p>
      <h2 id="options">Options</h2>
      <p>Use <code>window.boostHtmlConfig</code> or <code>createBoost()</code> to
      configure selectors, history, scrolling, script execution, headers and the
      NProgress bar.</p>
    `,
  })

const search = (req, url) => {
  const query = escapeHtml(url.searchParams.get('q') ?? '')
  return layout({
    req,
    title: 'Search',
    content: `
      <h1>Search results</h1>
      <p>Query: <code>${query}</code></p>
      <p>This page was produced by a boosted GET form submission; the form
      fields were encoded into the query string.</p>
      <p><a href="/">Back home</a></p>
    `,
  })
}

const greet = (req, url) => {
  const name = escapeHtml(url.searchParams.get('name') ?? 'world')
  return layout({
    req,
    title: 'Hello',
    content: `
      <h1>Hello, ${name}!</h1>
      <p>The POST handler answered with a <code>303 See Other</code> redirect.
      boost-html followed it and pushed <code>${escapeHtml(url.pathname + url.search)}</code>
      into the history.</p>
      <p><a href="/">Back home</a></p>
    `,
  })
}

const slow = async (req) => {
  await sleep(1200)
  return layout({
    req,
    title: 'Slow',
    content: `
      <h1>Slow page</h1>
      <p>The server waited 1.2 seconds. The NProgress bar trickled while the
      request was in flight and finished after the swap.</p>
      <p><a href="/">Back home</a></p>
    `,
  })
}

const scripts = (req) =>
  layout({
    req,
    title: 'Scripts',
    content: `
      <h1>Scripts</h1>
      <p>This page contains an inline script. The demo enables
      <code>executeScripts</code> explicitly; it is disabled by default.</p>
      <script>window.__boostScriptRan = true</script>
      <p><a href="/">Back home</a></p>
    `,
  })

const broken = (req) =>
  layout({
    req,
    title: 'Broken',
    content: `
      <h1>500 — something broke</h1>
      <p>boost-html got a non-OK response and fell back to a normal browser
      navigation, so you are seeing this error page from a full page load.</p>
      <p><a href="/">Back home</a></p>
    `,
  })

const notFound = (req) =>
  layout({
    req,
    title: 'Not found',
    content: `
      <h1>404</h1>
      <p>No page matches this URL. <a href="/">Go home</a></p>
    `,
  })

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return map[char]
  })
}

async function readForm(req) {
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: Readable.toWeb(req),
    duplex: 'half',
  })
  return request.formData()
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers })
  res.end(body)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  try {
    if (req.method === 'GET' && url.pathname === '/boost-html.js') {
      const bundle = await readFile(join(root, 'dist', 'index.global.js'))
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(bundle)
      return
    }

    if (req.method === 'POST' && url.pathname === '/greet') {
      const form = await readForm(req)
      const name = String(form.get('name') ?? 'world')
      res.writeHead(303, { location: `/greet?name=${encodeURIComponent(name)}` })
      res.end()
      return
    }

    if (req.method !== 'GET') {
      send(res, 405, layout({ req, title: 'Method not allowed', content: '<h1>405</h1>' }))
      return
    }

    switch (url.pathname) {
      case '/':
        return send(res, 200, home(req))
      case '/about':
        return send(res, 200, about(req))
      case '/docs':
        return send(res, 200, docs(req))
      case '/search':
        return send(res, 200, search(req, url))
      case '/greet':
        return send(res, 200, greet(req, url))
      case '/slow':
        return send(res, 200, await slow(req))
      case '/broken':
        return send(res, 500, broken(req))
      case '/scripts':
        return send(res, 200, scripts(req))
      default:
        return send(res, 404, notFound(req))
    }
  } catch (error) {
    console.error(error)
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Internal server error')
  }
})

server.listen(port, () => {
  console.log(`boost-html demo running at http://localhost:${port}`)
})
