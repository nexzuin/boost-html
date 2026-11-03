# boost-html

**Progressive enhancement for multi-page HTML applications.**

`boost-html` turns eligible same-origin links and forms into Fetch-powered
navigations. It swaps the contents of a target element, updates the browser
history, restores scroll and focus, and announces page changes to assistive
technology. Your server continues to return ordinary HTML documents, and links
and forms continue to work without JavaScript.

The project is inspired by [htmx `hx-boost`](https://htmx.org/attributes/hx-boost/)
and aims to keep the browser's native navigation model rather than introduce a
client-side router.

## Highlights

- Progressive enhancement: standard links and forms remain the source of truth.
- Same-origin `GET` navigation and form submission with native fallback rules.
- History, back/forward, hash scrolling, scroll restoration, focus management,
  and polite screen-reader announcements.
- Native DOM replacement by default; optional synchronous morph and swap hooks.
- Built-in progress indicator with no runtime dependency.
- Optional prefetch and in-memory LRU navigation cache, both disabled by default.
- Explicit response validation, script non-execution, CSP nonce and Trusted
  Types hooks, and conservative active-content filtering.
- ESM, CommonJS, browser IIFE bundles, and TypeScript declarations.

## Requirements and compatibility

- Modern browsers with Fetch, `AbortController`, `URL`, `DOMParser`, `FormData`,
  `CustomEvent`, `Element.closest`, `Element.replaceChildren`, and History API.
- Build target: ES2020. No browser polyfills are bundled.
- Browser integration suite: Chromium, Firefox, and WebKit. The strict Trusted
  Types enforcement test runs in Chromium, where the API is available.
- IE11 and legacy Edge are not supported.
- No mandatory runtime dependencies.

## Installation

```bash
npm install boost-html
```

## Quick start

### Automatic initialization

Importing the package root in a browser creates and starts one default instance.

```ts
import 'boost-html'
```

Mark the part of the page whose links and forms should be enhanced:

```html
<body>
  <header>
    <a href="/">Home</a>
    <a href="/account" data-boost="true">Account</a>
  </header>

  <main data-boost="true">
    <a href="/products">Products</a>
    <a href="/checkout" data-boost="false">Checkout (full navigation)</a>

    <form action="/search" method="get">
      <label>
        Search
        <input name="q" type="search">
      </label>
      <button type="submit">Search</button>
    </form>
  </main>
</body>
```

The default scope is `[data-boost="true"]`. `data-boost="false"` opts out an
element and its descendants, even when they are inside a boosted ancestor.

### Manual initialization

Use the side-effect-free `boost-html/core` entry when your application owns the
instance lifecycle. This avoids the root entry's automatic initialization.

```ts
import { createBoost } from 'boost-html/core'

const boost = createBoost({
  target: '#page-content',
  progress: true,
})

boost.start()

// Later, when the application is shutting down:
// boost.stop()
```

**Important:** importing `createBoost` from `boost-html` also evaluates the
root entry and creates the automatic instance. Use `boost-html/core` when you
want manual initialization only.

### Browser script bundle

The package exposes a browser IIFE through the `unpkg` and `jsdelivr` package
fields:

```html
<script defer src="https://unpkg.com/boost-html"></script>
```

The bundle exposes the `BoostHtml` namespace and creates `window.boostHtml`
when loaded in a browser. The auto-created instance can be configured before
the script runs:

```html
<script>
  window.boostHtmlConfig = {
    progress: { showSpinner: false },
    headers: { 'X-App-Version': 'web-2026' },
  }
</script>
<script defer src="https://unpkg.com/boost-html"></script>
```

`window.boostHtmlConfig` is read once during automatic initialization.

## Configuration

Pass options to `createBoost()` or set `window.boostHtmlConfig` before loading
the browser bundle.

```ts
import { createBoost } from 'boost-html/core'

const boost = createBoost({
  scope: '[data-boost="true"]',
  linkSelector: 'a[href]',
  formSelector: 'form[data-boost-submit]',
  target: (doc) => doc?.querySelector('[data-page-content]') ?? null,
  history: true,
  scroll: true,
  focus: 'auto',
  announce: true,
  progress: { showSpinner: false },
  headers: async () => ({ Authorization: `Bearer ${await getAccessToken()}` }),
})

boost.start()
```

### `BoostOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `scope` | `string` | `'[data-boost="true"]'` | Selector for boosted containers. The matching element itself is included. |
| `linkSelector` | `string` | `'a[href]'` | Selector for eligible links. |
| `formSelector` | `string` | `'form'` | Selector for eligible forms. |
| `target` | `string \| (document?: Document) => Element \| null` | `'body'` | Live DOM target and matching response target. |
| `swapStrategy` | `'replace' \| 'morph'` | `'replace'` | Built-in native replacement or an application-provided morph adapter. |
| `morphAdapter` | `MorphAdapter` | — | Synchronous adapter required by `swapStrategy: 'morph'` unless `swapHandler` is provided. |
| `swapHandler` | `DOMSwapHandler` | — | Custom synchronous DOM update; overrides the built-in strategy. |
| `scriptHandler` | `DOMScriptHandler` | — | Explicit handler for detached response scripts. No handler means no script execution. |
| `head` | `'title' \| 'metadata' \| false` | `'title'` | Update the title, title plus safe descriptive metadata, or no head fields. |
| `createHTML` | `(html: string) => string \| object` | — | Host-owned Trusted Types policy hook for response and custom progress-template parsing. |
| `history` | `boolean` | `true` | Use History API and handle boost-owned `popstate` entries. |
| `scroll` | `boolean` | `true` | Restore saved positions, scroll to hashes, or scroll to the top after a swap. |
| `focus` | `boolean \| string` | `'auto'` | Focus the main landmark when old focus is removed; use a selector, `'target'`, or `false`. |
| `announce` | `boolean` | `true` | Announce successful navigations through a polite live region. |
| `executeScripts` | `boolean` | `false` | Deprecated and ignored. Response scripts are never automatically executed. |
| `nonce` | `string` | `''` | CSP nonce for injected progress styles and the explicit script-handler context. |
| `maxResponseBytes` | `number` | `2097152` | Maximum navigation response body size in bytes. `0` disables the navigation limit; prefetch retains its own 2 MiB safety cap. |
| `requestTimeoutMs` | `number` | `0` | Request timeout in milliseconds. `0` disables the timeout. |
| `fallbackToNativeForm` | `boolean` | `false` | Retry a failed non-GET form natively. This can duplicate server-side effects. |
| `progress` | `boolean \| ProgressOptions` | `true` | Enable/configure the built-in progress indicator, or pass `false` to disable it. |
| `prefetch` | `PrefetchOptions` | `{ enabled: false }` | Optional speculative same-origin GET requests. |
| `cache` | `NavigationCacheOptions` | `{ enabled: false }` | Optional in-memory LRU for explicitly public HTML GET responses. |
| `headers` | `BoostHeaders` | `{}` | Additional request headers, or a synchronous/asynchronous function returning them. |

### `ProgressOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `minimum` | `number` | `0.08` | Starting progress fraction, clamped between 0.01 and 0.99. |
| `easing` | `string` | `'ease'` | CSS transition easing. |
| `speed` | `number` | `200` | Animation duration in milliseconds. |
| `trickle` | `boolean` | `true` | Automatically advance while a request is pending. |
| `trickleSpeed` | `number` | `800` | Trickle interval in milliseconds. |
| `showSpinner` | `boolean` | `true` | Show the spinner. |
| `parent` | `string` | `'body'` | Selector for the progress container's parent. |
| `template` | `string` | Built-in markup | Optional template using `#nprogress`, `.bar`, and `.spinner` conventions. Parsed and filtered before insertion. |

### `PrefetchOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Enable speculative prefetching. |
| `strategy` | `'hover' \| 'pointerdown' \| 'viewport' \| array` | `'hover'` | One or more triggers. |
| `delay` | `number` | `100` | Hover delay in milliseconds. |
| `maxConcurrent` | `number` | `2` | Maximum concurrent requests; capped at 8. |
| `exclude` | `string[]` | `[]` | Path prefixes never prefetched. |

Prefetch is GET-only, does not mutate the DOM or history, deduplicates in-flight
requests, and observes network conditions such as offline, Save-Data, and slow
connections. It retains at most eight responses for up to 30 seconds, subject
to shorter server freshness directives. Only explicitly public responses are
reused. See [API reference](./docs/API.md#prefetch) for the full policy.

### `NavigationCacheOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Enable the per-instance navigation cache. |
| `maxEntries` | `number` | `20` | Maximum cached URL/header variants; capped at 500. |
| `maxAge` | `number` | `30000` | Maximum local freshness lifetime in milliseconds. Server freshness can shorten it. |
| `exclude` | `string[]` | `[]` | Additional path prefixes never cached. |

The cache stores only status-200 same-origin HTML GET responses explicitly
marked `Cache-Control: public`. It respects `max-age`, `Expires`, `Age`,
`Vary`, and restrictive cache directives. Sensitive path segments are
excluded by default. `Authorization` is part of the explicit request-header
key; browser-managed HttpOnly cookies are not visible to JavaScript. Never mark
personalized or session-dependent HTML as public. Call `clearCache()` after
external login, logout, account, or tenant changes. Full details are in the
[security model](./docs/SECURITY.md#navigation-cache-isolation).

## HTML attributes and link behavior

- `data-boost="true"`: boost links and forms in this subtree.
- `data-boost="false"`: opt out this element and its subtree.
- `data-no-prefetch`, `data-boost-prefetch="false"`, or `data-boost-sensitive`:
  skip speculative requests.
- `data-no-cache` or `data-cache="false"`: skip navigation-cache and prefetch
  storage for this link/subtree.

A link is left to the browser when it is cross-origin, uses a non-HTTP(S)
scheme, has `target` other than `_self`, `download`, `aria-disabled="true"`,
`rel="external"`, or points to the current document's hash. Modified clicks
(Ctrl/Cmd/Shift/Alt) and non-primary mouse buttons are also left native.

## Navigation and forms

### Navigation lifecycle

1. A qualifying click or submit is intercepted inside the boosted scope.
2. `boost:before-request` is dispatched. A listener can cancel before Fetch.
3. The same-origin request is sent with the `HX-Request`, `HX-Boosted`, and
   `X-Requested-With` headers plus `Accept: text/html, */*; q=0.1`.
4. The response must be successful HTML, within the configured size limit,
   and its final redirect URL must remain same-origin HTTP(S).
5. The response document and configured target are parsed and validated.
6. `boost:before-swap` and `boost:before-dom-update` run before DOM mutation.
7. The target's children are replaced (or passed to the configured adapter),
   the title/allowed metadata is updated, and history is committed.
8. Scroll, focus, and accessibility announcements are applied, followed by
   `boost:after-dom-update` and `boost:after-swap`.

A newer navigation aborts the previous in-flight request. Canceled or stale
responses cannot commit DOM or history. A `204` or `205` response is treated as
successful with no DOM swap. Same-document hash links remain native.

### Form handling

- Boosted forms support native `GET` and `POST` submission semantics. A form
  with `method="dialog"`, a non-`_self` target, or a cross-origin action is
  left to the browser.
- GET form values are encoded into the query string. File inputs contribute
  their file names, not file bytes.
- POST encoding follows `enctype`: `application/x-www-form-urlencoded` by
  default, `multipart/form-data` for file uploads, and `text/plain` when set.
  Multipart boundaries are generated by Fetch; do not set them manually.
- Submitter overrides (`formaction`, `formmethod`, `formenctype`, and
  `formtarget`) are respected. Image submitters contribute `.x` / `.y` fields.
- A form cannot start a second boosted submission while its first is pending.
- Failed GET navigations fall back to a native top-level navigation. Failed
  non-idempotent forms are not retried by default. Setting
  `fallbackToNativeForm: true` explicitly accepts duplicate-submission risk.

The server remains responsible for CSRF protection, authorization, validation,
file-size/type checks, and idempotency.

## Lifecycle events

All events are dispatched on `document` and bubble. Event details are typed in
`BoostRequestDetail`, `BoostSwapDetail`, `BoostDOMUpdateDetail`, and
`BoostErrorDetail`.

| Event | Cancelable | When it fires |
| --- | --- | --- |
| `boost:before-request` | Yes | After request headers are resolved, before Fetch. |
| `boost:before-swap` | Yes | After the response document and final URL are validated. |
| `boost:before-dom-update` | Yes | After live/response targets are resolved, before mutation. |
| `boost:after-dom-update` | No | After the DOM and configured head fields are updated. |
| `boost:after-swap` | No | After history, scroll, focus, announcements, and script-handler invocation. |
| `boost:error` | Usually yes | On rejected requests/swaps; `preventDefault()` suppresses native fallback. Script-handler errors after a committed swap are reported non-cancelably. |

```ts
import type { BoostRequestDetail } from 'boost-html/core'

document.addEventListener('boost:before-request', (event) => {
  const detail = (event as CustomEvent<BoostRequestDetail>).detail
  if (detail.url.includes('/logout')) event.preventDefault()
})

document.addEventListener('boost:error', (event) => {
  const detail = (event as CustomEvent<{ error: unknown }>).detail
  console.error('Navigation failed:', detail.error)
  // preventDefault() keeps the current document instead of hard fallback.
  event.preventDefault()
})
```

## Public API

```ts
import { createBoost } from 'boost-html/core'

const boost = createBoost()
boost.start() // idempotent; returns the instance

const swapped = await boost.navigate('/dashboard', { push: 'replace' })
const prefetched = await boost.prefetch('/help')
boost.clearCache('/catalog')
boost.stop() // detaches listeners, aborts work, clears in-memory state
```

| API | Return | Description |
| --- | --- | --- |
| `createBoost(options?)` | `Boost` | Create a manually managed instance. |
| `getBoost()` | `Boost \| null` | Root-entry auto-created instance, or `null` outside a browser. |
| `boost.start()` | `this` | Attach listeners; repeated calls are safe. |
| `boost.stop()` | `this` | Detach listeners, abort in-flight work, clear cache/prefetch state, remove the announcement region, and restore scroll restoration. |
| `boost.navigate(url, options?)` | `Promise<boolean>` | Programmatic same-origin navigation; `true` means the response was swapped or handled as a successful no-content response. |
| `boost.prefetch(url)` | `Promise<boolean>` | Prefetch an eligible URL when enabled. |
| `boost.clearCache(url?)` | `this` | Clear all cached/prefetched responses or every variant of one URL. |

`NavigateOptions` accepts `method`, `body`, `headers`, `push`, `element`,
`form`, `scrollY`, and `focusId`. `push` can be `true` (push a history entry),
`'replace'` (replace the current entry), or `false` (do not write history).
`navigate()` returns `false` for rejected, canceled, aborted, or failed
navigations. `prefetch()` returns `false` when disabled, excluded, blocked by
network conditions, aborted, or unsuccessful.

## Security

Fetched HTML is not trusted merely because it came from a same-origin endpoint.
Scripts are not executed automatically; the response filter removes common
active-content surfaces, but it is not a general-purpose HTML sanitizer.

- Only same-origin HTTP(S) navigation and final redirect URLs are accepted.
- Response scripts, embedded browsing contexts, inline event attributes,
  response style elements, inline CSS, `srcdoc`, `srcset`, ping, customized
  built-in `is`, and unsafe URL schemes are filtered from the selected subtree.
- `createHTML` must be a restrictive host-owned Trusted Types policy; it does
  not sanitize content. `scriptHandler` is a privileged application hook.
- The progress stylesheet accepts a CSP nonce through `nonce`.
- `head: 'metadata'` copies only an allowlist of descriptive metadata, never
  response CSP, `http-equiv`, `<base>`, stylesheets, or scripts.
- The navigation cache is opt-in and stores only responses explicitly marked
  `Cache-Control: public`; never use that directive for personalized HTML.
- The server must enforce CSRF protection, authorization, output encoding, and
  validation. Client-side navigation is not a security boundary.

Read [SECURITY.md](./SECURITY.md) and the detailed
[security audit](./docs/SECURITY.md) before enabling caching or a script handler.

## Browser compatibility

The build targets ES2020 and relies on native browser APIs. The automated
Playwright suite currently covers Chromium, Firefox, and WebKit, including
history, forms, file uploads, network failure, cancellation, repeated
navigation, and script non-execution. The strict CSP/Trusted Types test runs in
Chromium. WebKit's Linux CI project runs headed under Xvfb.

The package does not ship polyfills. Applications supporting older browsers
must provide their own compatible platform APIs or use full-page navigation.

Development and release tooling requires Node.js 22.19.0 or later (or Node.js
24.11.0 or later). The published runtime is browser-oriented and does not
require Node.js; therefore the package intentionally does not declare a Node
`engines` restriction for consumers.

## Examples and guides

- [Complete API reference](./docs/API.md)
- [Migration guide](./docs/MIGRATION.md)
- [Security audit and threat boundaries](./docs/SECURITY.md)

### Example: dashboard with per-request authentication

```ts
import { createBoost } from 'boost-html/core'

const boost = createBoost({
  target: '#dashboard-content',
  headers: async () => ({
    Authorization: `Bearer ${await auth.getAccessToken()}`,
  }),
  cache: { enabled: false }, // personalized responses are not cacheable
})

boost.start()

// Call after logout/account switch if any optional cache was enabled.
// boost.clearCache()
```

### Example: search filters and file upload

```html
<section data-boost="true">
  <form action="/search" method="get">
    <input name="q" type="search" placeholder="Search products">
    <button type="submit">Search</button>
  </form>

  <form action="/documents" method="post" enctype="multipart/form-data">
    <input type="file" name="document" required>
    <button type="submit">Upload</button>
  </form>
</section>
```

### Example: explicitly public catalogue cache

```ts
const boost = createBoost({
  cache: {
    enabled: true,
    maxEntries: 30,
    maxAge: 15_000,
    exclude: ['/catalog/private'],
  },
})
boost.start()

// The server must return Cache-Control: public, max-age=15 for genuinely
// user-independent catalogue HTML. Do not use this for account pages.
```

## Development

```bash
npm ci
npx playwright install chromium firefox webkit
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run size
npm run verify:package
npm run test:integration
```

`npm run check` runs lint, typecheck, Vitest with coverage thresholds, build,
bundle-size gates, and package export/content verification. The 5 KiB core ESM
goal is still open; the current size limits are regression ceilings, not a claim
that the goal has been met.

## License

MIT. See [LICENSE](./LICENSE).
