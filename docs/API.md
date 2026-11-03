# API reference

This document describes the public TypeScript API, configuration, lifecycle
events, navigation behavior, and DOM update extension points. For an overview
and installation examples, see the [README](../README.md).

## Entry points

### `boost-html`

The package root exports `createBoost()`, `getBoost()`, and public types. When
loaded in a browser it also creates and starts a default instance using
`window.boostHtmlConfig` (or default options) and assigns it to
`window.boostHtml`.

```ts
import { createBoost, getBoost } from 'boost-html'

const automaticInstance = getBoost()
```

Importing the root entry for named exports still triggers automatic
initialization. Avoid creating a second instance unless that is intentional.

### `boost-html/core`

The `core` subpath exports `createBoost()` and public types without automatic
initialization. Use it when the application owns lifecycle management.

```ts
import { createBoost } from 'boost-html/core'

const boost = createBoost({ progress: false })
boost.start()
```

### Browser bundle

The IIFE bundle is `dist/index.global.js` and is published through the package's
`unpkg` and `jsdelivr` fields. It exposes the `BoostHtml` namespace and
`window.boostHtml` auto-created instance. The `core` IIFE is
`dist/core.global.js` and does not auto-initialize.

## Public functions and types

### `createBoost(options?: BoostOptions): Boost`

Creates a navigation controller. Construction resolves and freezes the
configuration shape; listeners are attached by `start()`.

### `getBoost(): Boost | null`

Returns the root entry's auto-created instance. Returns `null` when the root
entry has not auto-initialized or when called outside a browser environment.

### `Boost`

| Member | Signature | Behavior |
| --- | --- | --- |
| `options` | `readonly ResolvedBoostOptions` | Resolved configuration for this instance. |
| `start()` | `this` | Attaches delegated click/submit/popstate listeners. Safe to call repeatedly. |
| `stop()` | `this` | Removes listeners, aborts active requests, clears prefetch/cache memory, removes the announcement region, and restores the previous `history.scrollRestoration` value. Safe to call repeatedly. |
| `navigate(url, options?)` | `Promise<boolean>` | Performs programmatic same-origin navigation. `true` means a successful response was swapped or a 204/205 was handled. `false` means rejected, canceled, aborted, or failed. |
| `prefetch(url)` | `Promise<boolean>` | Prefetches an eligible URL if prefetch is enabled. Returns false when disabled, excluded, blocked, aborted, or unsuccessful. |
| `clearCache(url?)` | `this` | Clears all navigation and prefetch entries, or all variants for one URL. |

### `NavigateOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `method` | `string` | `'GET'` | Fetch method. GET/HEAD must not have a body. Form interception itself supports GET and POST. |
| `body` | `BodyInit \| null` | `null` | Request body for methods that accept one. |
| `headers` | `Record<string, string>` | `{}` | Headers for this navigation only; merged over configured headers. |
| `push` | `boolean \| 'replace'` | `true` | Push history, replace current entry, or leave history unchanged. |
| `element` | `Element \| null` | `null` | Element that initiated the navigation; included in event detail. |
| `form` | `HTMLFormElement \| null` | `null` | Form that initiated the navigation; used for explicit native form fallback. |
| `scrollY` | `number \| null` | `null` | Explicit scroll position to restore. |
| `focusId` | `string \| null` | `null` | Internal/advanced focus restoration ID for history traversal. |

### Event detail types

- `BoostRequestDetail`: `url`, `method`, `element`, `form`, `headers`.
- `BoostSwapDetail`: request detail plus `response` and parsed `document`.
- `BoostDOMUpdateDetail`: swap detail plus live `target` and parsed `incoming` target.
- `BoostErrorDetail`: request detail plus `error: unknown`.

Other exported types include `BoostOptions`, `ResolvedBoostOptions`,
`BoostHeaders`, `ProgressOptions`, `PrefetchOptions`,
`ResolvedPrefetchOptions`, `NavigationCacheOptions`,
`ResolvedNavigationCacheOptions`, `HeadUpdateMode`, `DOMUpdateContext`,
`DOMSwapHandler`, `DOMScriptHandler`, and `MorphAdapter`.

## Configuration reference

### `BoostOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `scope` | `string` | `'[data-boost="true"]'` | Selector for boosted subtrees; the matching element is included. |
| `linkSelector` | `string` | `'a[href]'` | Selector for links eligible for interception. |
| `formSelector` | `string` | `'form'` | Selector for forms eligible for interception. |
| `target` | `string \| ((document?: Document) => Element \| null)` | `'body'` | Live target and matching response target. String selectors are evaluated in both documents. |
| `swapStrategy` | `'replace' \| 'morph'` | `'replace'` | Built-in native replacement or configured morph adapter. |
| `morphAdapter` | `MorphAdapter` | — | Synchronous morph adapter, required for morph mode unless `swapHandler` is supplied. |
| `swapHandler` | `DOMSwapHandler` | — | Custom synchronous update that overrides the built-in strategy. |
| `scriptHandler` | `DOMScriptHandler` | — | Explicit processing hook for detached response scripts. It may return a Promise. |
| `head` | `'title' \| 'metadata' \| false` | `'title'` | Update title, title plus allowlisted descriptive metadata, or no head fields. |
| `createHTML` | `(html: string) => string \| object` | — | Host-owned Trusted Types hook for DOMParser input. Must return TrustedHTML under strict enforcement. Does not sanitize. |
| `history` | `boolean` | `true` | Use History API and handle only boost-owned popstate entries. |
| `scroll` | `boolean` | `true` | Save/restore scroll, follow URL hashes, and otherwise scroll to top. |
| `focus` | `boolean \| string` | `'auto'` | Automatically focus main content when prior focus is removed; selector or `'target'` chooses another target; false disables it. |
| `announce` | `boolean` | `true` | Announce successful navigation through a polite live region. |
| `executeScripts` | `boolean` | `false` | Deprecated compatibility option. It is ignored; scripts are never automatically executed. |
| `nonce` | `string` | `''` | CSP nonce applied to progress styles and exposed to explicit script handlers. |
| `maxResponseBytes` | `number` | `2 * 1024 * 1024` | Navigation response body limit in bytes. Zero disables the navigation body limit; prefetch retains its own 2 MiB cap. |
| `requestTimeoutMs` | `number` | `0` | Abort a request after this many milliseconds. Zero disables timeout. |
| `fallbackToNativeForm` | `boolean` | `false` | Retry a failed non-GET form through native submit. May duplicate server-side effects. |
| `progress` | `boolean \| ProgressOptions` | `true` | Enable/configure built-in progress UI or disable with false. |
| `prefetch` | `PrefetchOptions` | `{ enabled: false }` | Optional speculative GET requests. |
| `cache` | `NavigationCacheOptions` | `{ enabled: false }` | Optional per-instance navigation LRU. |
| `headers` | `BoostHeaders` | `{}` | Static headers or a function returning headers synchronously/asynchronously. |

`BoostHeaders` is `Record<string, string>` or a function returning that record
or a `Promise` of it. Per-navigation headers passed to `navigate()` override
configured headers.

### `ProgressOptions`

| Field | Type | Default |
| --- | --- | --- |
| `minimum` | `number` | `0.08` |
| `easing` | `string` | `'ease'` |
| `speed` | `number` | `200` ms |
| `trickle` | `boolean` | `true` |
| `trickleSpeed` | `number` | `800` ms |
| `showSpinner` | `boolean` | `true` |
| `parent` | `string` | `'body'` |
| `template` | `string` | Built-in template |

The custom template should follow `#nprogress`, `.bar`, and `.spinner`
conventions. It is parsed with DOMParser and filtered before insertion. Under
Trusted Types enforcement, the host `createHTML` hook is also used for this
input. The progress stylesheet receives `nonce` when configured.

### `PrefetchOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Enable prefetch. |
| `strategy` | `'hover' \| 'pointerdown' \| 'viewport' \| array` | `'hover'` | One or more prefetch triggers. |
| `delay` | `number` | `100` ms | Hover delay. |
| `maxConcurrent` | `number` | `2` | Concurrent requests, capped at 8. |
| `exclude` | `string[]` | `[]` | Excluded path prefixes. |

Prefetch is GET-only, same-origin, deduplicates in-flight URLs, and does not
mutate DOM/history or dispatch navigation lifecycle events. It is skipped while
offline, when Save-Data is enabled, on 2g/slow-2g, or below the configured
network downlink threshold. The queue is bounded, and speculative work is
canceled when it is no longer useful. Only successful same-origin HTML
responses explicitly marked `Cache-Control: public` are retained. Server
freshness directives and `Vary` are enforced.

### `NavigationCacheOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Enable in-memory cache. |
| `maxEntries` | `number` | `20` | LRU entry limit, capped at 500. |
| `maxAge` | `number` | `30000` ms | Local freshness upper bound. |
| `exclude` | `string[]` | `[]` | Additional excluded path prefixes. |

The cache stores only status-200 same-origin HTML GET responses with explicit
`Cache-Control: public`. It rejects `no-store`, `no-cache`, `private`, stale
freshness, `Vary: Cookie`, `Vary: *`, and `Vary` fields not represented by
explicit request headers. Authorization is included in the request-header key.
HttpOnly cookies are not readable from JavaScript; the server must guarantee
that a public response is reusable across users and must not set cookies on
such responses. State-changing requests clear cache and prefetch state before
and after the request. Call `clearCache()` after external auth or tenant changes.

## Lifecycle events

Events are dispatched on `document` and bubble. The lifecycle for a successful
navigation is:

```text
boost:before-request
  -> fetch and validate response / final URL
  -> boost:before-swap
  -> boost:before-dom-update
  -> DOM update, head update, history, scroll, focus, announcement
  -> boost:after-dom-update
  -> invoke explicit scriptHandler, if configured
  -> boost:after-swap
```

| Event | Cancelable | Detail type |
| --- | --- | --- |
| `boost:before-request` | Yes | `BoostRequestDetail` |
| `boost:before-swap` | Yes | `BoostSwapDetail` |
| `boost:before-dom-update` | Yes | `BoostDOMUpdateDetail` |
| `boost:after-dom-update` | No | `BoostDOMUpdateDetail` |
| `boost:after-swap` | No | `BoostSwapDetail` |
| `boost:error` | Yes for navigation failures; no for post-swap script-handler failures | `BoostErrorDetail` |

Calling `preventDefault()` on `boost:before-request` prevents Fetch. Canceling
`boost:before-swap` prevents the swap after response validation. Canceling
`boost:before-dom-update` prevents DOM mutation after target validation.
Canceling a cancelable `boost:error` opts out of hard-navigation fallback and
leaves the current document in place. Script-handler errors are reported
non-cancelably because the DOM has already been committed.

```ts
import type { BoostRequestDetail } from 'boost-html/core'

document.addEventListener('boost:before-request', (event) => {
  const { url } = (event as CustomEvent<BoostRequestDetail>).detail
  if (url.includes('/logout')) event.preventDefault()
})
```

## Navigation and form behavior

### Links

Only links inside the configured scope and matching `linkSelector` are
considered. Cross-origin links, non-HTTP(S) schemes, `target` other than
`_self`, downloads, `aria-disabled="true"`, `rel="external"`, same-document
hashes, modified clicks, and non-primary clicks remain native.

### Forms

Only forms inside the configured scope and matching `formSelector` are
considered. `GET` and `POST` are supported for intercepted forms. `dialog`
submissions, cross-origin actions, and non-`_self` targets remain native.

- GET form fields are appended to the action query. File inputs contribute the
  file name, not file contents.
- POST honors `enctype`: urlencoded by default, multipart for file uploads, and
  `text/plain` when requested.
- Submitter `formaction`, `formmethod`, `formenctype`, and `formtarget` override
  form attributes. Image inputs submit `.x` / `.y` coordinates.
- A form is locked against duplicate boosted submissions while its request is
  pending.
- A failed GET request falls back to a native top-level navigation. Failed
  non-idempotent forms are not automatically replayed. `fallbackToNativeForm`
  explicitly opts into possible duplicate side effects.

### Responses and redirects

A response must be successful and declare `text/html` or
`application/xhtml+xml`. The body is limited to 2 MiB by default. The final URL
after redirects must be same-origin HTTP(S), contain no embedded credentials,
and is used for history. A 204/205 is treated as successful without a DOM swap.
The response must parse into a valid HTML document and contain the configured
target. The library does not validate every HTML conformance rule.

### History, scroll and focus

Successful navigations push history by default; `push: 'replace'` replaces the
current entry, and `push: false` avoids a new history entry. Existing
`history.state` is retained inside a namespaced `__boostHtml` state wrapper.
Only entries marked by boost-html are handled on `popstate`; unrelated router
entries are left untouched. Same-URL pushes are replaced rather than
duplicated. If a History API update fails after the swap, a native navigation is
started to keep URL and content consistent.

When enabled, the outgoing scroll offset and focused element ID are saved.
Back/forward restores the saved position and focus, hashes scroll to their
anchor, and other successful navigations scroll to the top. Focus defaults to
`main`, `[role="main"]`, or `h1` only when previous focus was removed. A polite
live region announces successful navigation. `stop()` restores the previous
`history.scrollRestoration` value and removes the announcement region.

## DOM update extension points

### Target selection

A string target selector is resolved in the live document before the request
and in the parsed response document after it. Both targets must exist. The live
target element remains; its children are replaced.

A document-aware callback can choose a target in each document:

```ts
createBoost({
  target: (doc) => doc?.querySelector('[data-page-content]') ?? null,
})
```

Legacy zero-argument target callbacks remain supported; they select the live
target and use the response body's children as incoming content.

### Native replacement and morph adapters

The default `replace` strategy moves already-parsed nodes using native DOM
operations. It does not preserve descendant node identity or form-control
state. `morph` requires a synchronous `morphAdapter` or `swapHandler`.

```ts
createBoost({
  target: '#content',
  swapStrategy: 'morph',
  morphAdapter: {
    morph(target, incoming, context) {
      myMorphLibrary(target, incoming, context)
    },
  },
})
```

`DOMSwapHandler` is a synchronous callback receiving `DOMUpdateContext` and
overrides the built-in strategy. `DOMUpdateContext` contains `target`,
`incoming`, parsed `document`, final validated `url`, `response`, and `nonce`.

### Head updates

- `head: 'title'` (default) updates `document.title`.
- `head: 'metadata'` also synchronizes a conservative allowlist of descriptive
  meta tags: description, keywords, author, robots, theme-color,
  application-name, color-scheme, and selected Open Graph properties.
- `head: false` leaves the current head unchanged.

Response CSP, `http-equiv`, charset, `<base>`, links, stylesheets, and scripts
are not copied.

### Script handling and Trusted Types

Scripts in the selected response subtree are removed and never automatically
executed. The deprecated `executeScripts` option is ignored. If an application
supplies `scriptHandler`, it receives detached script nodes and the update
context; it is responsible for validating and explicitly loading any approved
script. A Promise returned by the handler is not awaited by navigation. Errors
are logged and emitted as non-cancelable `boost:error` events after the swap.

Under `require-trusted-types-for 'script'`, provide `createHTML` backed by a
host-owned Trusted Types policy and return its `TrustedHTML` value. The hook is
used for response HTML and custom progress templates. It is not a sanitizer;
do not create a permissive policy just to suppress browser errors. Pass `nonce`
for the progress stylesheet and to expose the nonce to the script handler.

The active-content filter is defense in depth, not a general-purpose HTML
sanitizer. See [SECURITY.md](./SECURITY.md) and
[the full audit](./SECURITY.md) for residual risks and server responsibilities.

## Migration

See the [migration guide](./MIGRATION.md) for breaking changes and upgrade
steps from the 0.1.x development line to the planned stable 1.0 API.
