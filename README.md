# boost-html

Progressive enhancement for multi-page HTML sites, inspired by
[`hx-boost`](https://htmx.org/attributes/hx-boost/) from htmx.

Add `data-boost="true"` to a container and every link and form inside it is
fetched with `fetch()`, then the configured DOM target is updated in place — no
full page reload, while the markup stays plain HTML. Without JavaScript, links and forms
keep working exactly as usual.

- Intercepts same-origin links and form submissions
- Updates `document.title` and `history` (`pushState` / `popstate`)
- Restores the scroll position when navigating back and forward
- Native DOM replacement by default, with optional custom swap and morph adapters
- Response scripts are removed; explicit script handling is opt-in
- Includes a small native progress bar (styles injected automatically, no CSS import needed)
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

For manual control without importing the auto-initialising entry point, use the side-effect-free core subpath:

```ts
import { createBoost } from 'boost-html/core'

const boost = createBoost()
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
| `target`                | `string \| (document?: Document) => Element \| null`     | `'body'`                             | Live target and matching response target.                                   |
| `swapStrategy`          | `'replace' \| 'morph'`                                    | `'replace'`                          | Native replacement or an injected morph adapter.                            |
| `morphAdapter`          | `MorphAdapter`                                              | —                                    | Optional adapter used only with `swapStrategy: 'morph'`.                     |
| `swapHandler`           | `DOMSwapHandler`                                            | —                                    | Custom synchronous DOM update; overrides the built-in strategy.              |
| `scriptHandler`         | `DOMScriptHandler`                                          | —                                    | Explicit handler for detached response script nodes.                         |
| `head`                  | `'title' \| 'metadata' \| false`                         | `'title'`                            | Update title, title plus safe metadata, or no head fields.                   |
| `createHTML`            | `(html: string) => string \| object`                       | —                                    | Trusted Types policy hook before DOMParser.                                   |
| `history`               | `boolean`                                                | `true`                               | Push history entries and handle `popstate`.                                 |
| `scroll`                | `boolean`                                                | `true`                               | Scroll to the top or to the URL hash after a swap.                          |
| `executeScripts`        | `boolean`                                                | `false`                              | Deprecated compatibility option; scripts are never automatically executed. |
| `nonce`                 | `string`                                                 | `''`                                 | CSP nonce for progress styles; also passed to the explicit script handler. |
| `maxResponseBytes`      | `number`                                                 | `2097152` (2 MiB)                    | Maximum response body size. `0` disables the limit.                         |
| `requestTimeoutMs`      | `number`                                                 | `0`                                  | Request timeout in milliseconds. `0` disables the timeout.                  |
| `fallbackToNativeForm`  | `boolean`                                                | `false`                              | Re-submit a failed POST form natively. Can duplicate server-side effects.   |
| `progress`              | `boolean \| ProgressOptions`                             | `true`                               | Native progress bar. `false` disables it; an object configures its timing and appearance.         |
| `headers`               | `Record<string, string> \| () => Record<string, string>` | `{}`                                 | Extra headers for every boosted request.                                    |

`ProgressOptions` supports `minimum`, `easing`, `speed`, `trickle`,
`trickleSpeed`, `showSpinner`, `parent` and `template`. The built-in progress UI uses native DOM and CSS and has no runtime dependency; custom templates use the `#nprogress`, `.bar` and `.spinner` conventions.

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
- Starting a new navigation aborts the in-flight one; stale responses cannot
  update the DOM or history.
- A form cannot start a second boosted submission while its first submission
  is still pending.
- Set `requestTimeoutMs` to a positive number to abort a request after that
  many milliseconds. A timeout follows the normal error/fallback path.

The response is expected to produce a complete HTML document. The browser's HTML parser repairs many malformed fragments, so structural validation can reject unusable documents but is not a strict HTML validator. HTML is parsed once with `DOMParser`; parsing is not sanitization. The configured target is selected in both the live document and parsed response. By default, its children are replaced with native DOM APIs. `document.title` is updated by default; `head: 'metadata'` additionally synchronizes a conservative allowlist of descriptive meta tags. Security-sensitive head entries such as CSP, `http-equiv`, `<base>`, links and styles are never copied. See [DOM Engine API](./docs/API.md) for target callbacks, custom swaps, lifecycle events, Trusted Types and the morph-adapter evaluation.

## Events

All events are dispatched on `document` and bubble.

| Event                  | Cancelable | Detail                                                        |
| ---------------------- | ---------- | ------------------------------------------------------------- |
| `boost:before-request` | yes        | `{ url, method, element, form, headers }`                     |
| `boost:before-swap`    | yes        | `{ url, method, element, form, headers, response, document }` |
| `boost:before-dom-update` | yes     | `{ ...request, response, document, target, incoming }`         |
| `boost:after-dom-update`  | no      | `{ ...request, response, document, target, incoming }`         |
| `boost:after-swap`     | no         | `{ url, method, element, form, headers, response, document }` |
| `boost:error`          | yes        | `{ url, method, element, form, headers, error }`              |

Calling `preventDefault()` on `boost:before-request` or `boost:before-swap`
skips the navigation/swap. Canceling `boost:before-dom-update` prevents the DOM
mutation after the response and target have been validated. Calling it on
`boost:error` opts out of the hard fallback, letting you render your own error state.

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

`boost-html` is not a general-purpose HTML sanitizer. Fetched HTML remains
untrusted even after parsing and the limited active-content filtering described
below. Prefer server-side output encoding and a strict Content Security Policy.

- Only same-origin `http(s)` navigations are intercepted. Redirects whose final
  URL is cross-origin or non-http(s) are rejected.
- `<script>` elements are always removed before DOM insertion. Inline event
  handler attributes (`on*`), `srcdoc`, and `javascript:` / `vbscript:` URL
  attributes on response descendants are removed as defense in depth.
- `executeScripts` is deprecated and has no effect. Scripts are never
  automatically executed, inline or external. An explicitly configured
  `scriptHandler` receives detached script nodes and may implement application-
  specific behavior. Doing so is equivalent to opting into execution of
  untrusted code; validate sources, enforce CSP, and apply the supplied nonce.
- `createHTML` lets an application pass a Trusted Types policy result to
  `DOMParser` when `require-trusted-types-for 'script'` is enforced. The policy
  must be created by the host application; boost-html does not create a default
  permissive policy or sanitize HTML.
- `head: 'metadata'` updates only allowlisted descriptive meta tags. It never
  copies response CSP, `http-equiv`, `<base>`, stylesheets, or script elements.
- The limited active-content filtering is not a substitute for a vetted
  sanitizer when accepting arbitrary or user-generated HTML.
- A response must declare an HTML content type. Missing or non-HTML content
  types are rejected.
- Response bodies are limited to 2 MiB by default (`maxResponseBytes`).
- Failed non-idempotent forms are never re-submitted automatically.
- Pass `nonce` when your CSP requires one. The swap uses DOM node adoption
  rather than `innerHTML`; `createHTML` can provide a Trusted Types policy result
  for DOMParser input under strict Trusted Types enforcement. The progress UI
  still follows your CSP.

See [SECURITY.md](./SECURITY.md) for the full security model and reporting
process.

## Browser support

The library targets evergreen browsers with these platform APIs:

`fetch`, `AbortController`, `URL`, `URLSearchParams`, `DOMParser`,
`CustomEvent`, `Element.closest`, `Element.replaceChildren`, `FormData(form)` and
the History API. `history.scrollRestoration` is feature-detected.

Tested in Chromium via Playwright. Firefox and WebKit are planned for the
browser matrix; IE11 and legacy Edge are not supported. The build targets
ES2020 and does not ship polyfills.

## Migration from 0.1.x

- `executeScripts` is deprecated and ignored. Configure `scriptHandler` if
  application-specific script processing is required.
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
scroll restoration, inert response scripts and the 500 fallback path.

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
- The configured target's children are replaced; the target element itself and
  `<html>`/`<body>` attributes are preserved. Head updates are limited to title
  and the safe metadata allowlist described above.
- Response scripts are removed and never executed automatically. An explicit
  `scriptHandler` is responsible for any application-specific script loading.
- The native replace strategy does not preserve descendant node identity,
  focus, or form-control state. Choose an application-supplied morph adapter
  when those behaviors are required.
- Multiple `createBoost()` instances each handle `popstate`; use one instance per
  document for history ownership.

## License

MIT
