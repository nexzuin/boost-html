# boost-html

Progressive enhancement for multi-page HTML sites, inspired by
[`hx-boost`](https://htmx.org/attributes/hx-boost/) from htmx.

Add `data-boost="true"` to a container and every link and form inside it is
fetched with `fetch()`, then the page body is swapped in place — no full page
reload, while the markup stays plain HTML. Without JavaScript, links and forms
keep working exactly as usual.

- Intercepts same-origin links and form submissions
- Updates `document.title` and `history` (`pushState` / `popstate`)
- Restores the scroll position when navigating back and forward
- Optional script re-execution (disabled by default)
- Shows an [NProgress](https://ricostacruz.com/nprogress/) bar (styles injected
  automatically, no CSS import needed)
- Rejects cross-origin redirects, non-http(s) URLs and non-HTML responses
- Falls back to a normal browser navigation for failed GET requests
- Cancelable `boost:*` events for custom behaviour

## Install

```bash
npm install boost-html
```

Then import it once. The module auto-creates and starts an instance in the
browser:

```ts
import 'boost-html'
```

```html
<body data-boost="true">
  <a href="/about">About</a>
  <a href="/external" data-boost="false">Full page load</a>
</body>
```

With a bundler you can also import the API:

```ts
import { createBoost } from 'boost-html'

const boost = createBoost({ progress: false })
boost.start()
```

Or use the browser bundle, which also auto-initialises:

```html
<script src="https://unpkg.com/boost-html"></script>
```

`window.boostHtml` exposes the auto-created instance.

## Configuration

Set `window.boostHtmlConfig` before the library loads:

```html
<script>
  window.boostHtmlConfig = {
    progress: { showSpinner: true, trickleSpeed: 120 },
    headers: { 'X-Custom': 'yes' },
  }
</script>
<script src="https://unpkg.com/boost-html"></script>
```

Or pass options to `createBoost()`:

```ts
import { createBoost } from 'boost-html'

const boost = createBoost({
  scope: '[data-boost="true"]',
  progress: false,
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
})
boost.start()
```

### Options

| Option                  | Type                                                     | Default                              | Description                                                                 |
| ----------------------- | -------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `scope`                 | `string`                                                 | `'[data-boost="true"]'`              | Selector for boosted subtrees.                                              |
| `linkSelector`          | `string`                                                 | `'a[href]'`                          | Selector used to find links.                                                |
| `formSelector`          | `string`                                                 | `'form'`                             | Selector used to find forms.                                                |
| `target`                | `string \| () => Element \| null`                        | `'body'`                             | Where the fetched body is swapped in.                                       |
| `history`               | `boolean`                                                | `true`                               | Push history entries and handle `popstate`.                                 |
| `scroll`                | `boolean`                                                | `true`                               | Scroll to the top or to the URL hash after a swap.                          |
| `executeScripts`        | `boolean`                                                | `false`                              | Re-run scripts found in the response body. Opt-in; see the security section. |
| `nonce`                 | `string`                                                 | `''`                                 | CSP nonce for injected progress styles and re-executed scripts.             |
| `maxResponseBytes`      | `number`                                                 | `2097152` (2 MiB)                    | Maximum response body size. `0` disables the limit.                         |
| `fallbackToNativeForm`  | `boolean`                                                | `false`                              | Re-submit a failed POST form natively. Can duplicate server-side effects.   |
| `progress`              | `boolean \| ProgressOptions`                             | `true`                               | NProgress bar. `false` disables it, an object configures NProgress.         |
| `headers`               | `Record<string, string> \| () => Record<string, string>` | `{}`                                 | Extra headers for every boosted request.                                    |

`ProgressOptions` accepts the usual NProgress settings: `minimum`, `easing`,
`speed`, `trickle`, `trickleSpeed`, `showSpinner`, `parent` and `template`.

### Attributes

- `data-boost="true"` — boost all links and forms inside this element
  (the element itself is included).
- `data-boost="false"` — opt out for this element and its subtree. It wins over
  any boosted ancestor.

Links are left to the browser when they are external, have `target` other than
`_self`, have `download`, `rel="external"`, or point to the current hash. Clicks
with modifier keys or a non-primary button are ignored too.

## Requests

Every boosted request sends:

```http
X-Requested-With: XMLHttpRequest
HX-Request: true
HX-Boosted: true
Accept: text/html, */*; q=0.1
```

- `GET` forms encode their fields into the query string (file inputs use the
  file name).
- `POST` forms honour `enctype`: multipart, urlencoded and `text/plain`.
- Submitter `formaction`, `formmethod`, `formenctype` and `formtarget` are
  respected; image buttons submit `name.x` / `name.y` coordinates.
- 2xx responses must declare `text/html` or `application/xhtml+xml`.
- Response bodies larger than `maxResponseBytes` are rejected before parsing.
- Redirects are followed only when the final URL is same-origin and `http(s)`;
  the final URL is what gets pushed into history.
- Failed GET navigations fall back to a hard browser navigation. Failed POST
  navigations are **not** retried automatically; opt in with
  `fallbackToNativeForm` if you accept the duplication risk.
- Starting a new navigation aborts the in-flight one.

The response is expected to be a complete HTML document. Only `document.body`
is swapped; `document.title` is updated from the response, other `<head>`
changes are not applied. `<script>` elements are removed when script execution
is disabled, and re-created at their original position when it is enabled.

## Events

All events are dispatched on `document` and bubble.

| Event                  | Cancelable | Detail                                                        |
| ---------------------- | ---------- | ------------------------------------------------------------- |
| `boost:before-request` | yes        | `{ url, method, element, form, headers }`                     |
| `boost:before-swap`    | yes        | `{ url, method, element, form, headers, response, document }` |
| `boost:after-swap`     | no         | `{ url, method, element, form, headers, response, document }` |
| `boost:error`          | yes        | `{ url, method, element, form, headers, error }`              |

Calling `preventDefault()` on `boost:before-request` or `boost:before-swap`
skips the navigation/swap. Calling it on `boost:error` opts out of the hard
fallback, letting you render your own error state.

```ts
document.addEventListener('boost:before-request', (event) => {
  const { url } = (event as CustomEvent).detail
  if (url.includes('/logout')) event.preventDefault()
})
```

## Programmatic API

```ts
import { createBoost } from 'boost-html'

const boost = createBoost()
boost.start()

await boost.navigate('/dashboard', { push: 'replace' })
boost.stop()
```

`navigate()` only accepts same-origin `http(s)` URLs. It resolves to `true`
when the response was swapped in and `false` when the navigation was rejected,
aborted, canceled, or failed.
`stop()` removes the listeners, aborts in-flight requests and restores the
previous `history.scrollRestoration` value.

## Security

`boost-html` is not an HTML sanitizer. Fetched HTML is trusted only as much as a
normal full-page load of the same URL.

- Only same-origin `http(s)` navigations are intercepted. Redirects whose final
  URL is cross-origin or non-http(s) are rejected.
- **Scripts are not executed by default.** Opt in with
  `executeScripts: true`. Disabling scripts does not strip inline event-handler
  attributes (such as `onerror`) or `javascript:` URLs from fetched markup; treat
  response HTML as trusted input or sanitize it on the server.
- A response must declare an HTML content type. Missing or non-HTML content
  types are rejected.
- Response bodies are limited to 2 MiB by default (`maxResponseBytes`).
- Failed non-idempotent forms are never re-submitted automatically.
- Pass `nonce` when your CSP requires one. The swap uses DOM node adoption
  rather than `innerHTML`, so it does not require a Trusted Types policy for the
  replacement itself; injected progress CSS and re-executed scripts still follow
  your CSP.

See [SECURITY.md](./SECURITY.md) for the full security model and reporting
process.

## Browser support

The library targets evergreen browsers with these platform APIs:

`fetch`, `AbortController`, `URL`, `URLSearchParams`, `DOMParser`,
`CustomEvent`, `Element.closest`, `Element.replaceWith`, `FormData(form)` and
the History API. `history.scrollRestoration` is feature-detected.

Tested in Chromium via Playwright. Firefox and WebKit are planned for the
browser matrix; IE11 and legacy Edge are not supported. The build targets
ES2020 and does not ship polyfills.

## Migration from 0.1.x

- `executeScripts` now defaults to `false`; set it to `true` to keep the old
  behavior.
- POST forms without `enctype` now use native urlencoded encoding. Add
  `enctype="multipart/form-data"` if your server expects multipart bodies.
- Cross-origin `navigate()` calls and cross-origin redirects are rejected.
- Missing `Content-Type` headers are rejected.
- Failed POST forms are no longer re-submitted natively unless
  `fallbackToNativeForm: true` is set.

## Demo

```bash
npm install
npm run demo
```

Open <http://localhost:3000>. The demo server covers boosted navigation, GET and
POST forms, a slow route for the progress bar, hash scrolling, back/forward
scroll restoration, opt-in script execution and the 500 fallback path.

## Development

```bash
npm ci
npx playwright install chromium
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run size
npm run test:e2e
npm run bench
```

`npm run check` runs lint, typecheck, coverage, build and the size gate.
`npm run build` emits minified ESM, CJS, an IIFE browser bundle, sourcemaps and
type declarations in `dist/`.

## Limitations

- The server must return full HTML documents; partial fragments are not
  supported (this is `hx-boost` semantics, not `hx-get`).
- Only the body is swapped. `<head>` changes other than `document.title`,
  `<html>`/`<body>` attributes and `<base>` changes are not applied.
- Re-executed inline scripts and the injected progress CSS require a Content
  Security Policy that allows them, or a matching `nonce`.
- Scripts inside `<head>` are not re-executed.
- Scripts are re-created sequentially; `async`/`defer` timing is not preserved.
- Multiple `createBoost()` instances each handle `popstate`; use one instance per
  document for history ownership.

## License

MIT
