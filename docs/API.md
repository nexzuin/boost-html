# DOM Engine API

The DOM Engine runs only after the Fetch response has passed HTTP status,
content-type, size, final-URL, document-shape, and target validation. HTML is
parsed once with DOMParser; the parsed response is reused for target selection
and the swap.

## Target selection

```ts
import { createBoost } from 'boost-html/core'

const boost = createBoost({
  target: '#app-content',
})
boost.start()
```

A string selector is evaluated once against the live document before the
request and once against the parsed response. Both elements must exist. The
response target supplies the children used for the update; the live target
itself remains in place.

A document-aware callback can select different elements in the live and
response documents:

```ts
target: (doc) => doc?.querySelector('[data-page-content]') ?? null
```

The legacy zero-argument callback remains supported. It selects the live
target and uses the response body's children as incoming content.

## Swap strategies

The default swapStrategy is 'replace'. It uses native DocumentFragment and
Element.replaceChildren() to move already-parsed nodes without serializing or
parsing HTML again. The target element is preserved; its descendants are
replaced.

```ts
createBoost({ target: '#content', swapStrategy: 'replace' })
```

Morphing is optional and has no bundled implementation:

```ts
import { createBoost } from 'boost-html/core'
import { morph } from 'your-morph-adapter'

createBoost({
  target: '#content',
  swapStrategy: 'morph',
  morphAdapter: {
    morph(target, incoming) {
      morph(target, incoming)
    },
  },
})
```

The adapter must update synchronously. swapStrategy: 'morph' requires a
morphAdapter unless a custom swapHandler is supplied. swapHandler overrides
the built-in strategy and is also synchronous so the engine can keep response
ownership and DOM commits atomic with respect to newer navigations.

## Custom swap lifecycle

Events are dispatched on document and bubble:

| Event | Cancelable | Meaning |
| --- | --- | --- |
| boost:before-swap | yes | Response document has been parsed and validated. |
| boost:before-dom-update | yes | Both live and response targets are resolved; cancel to prevent mutation. |
| boost:after-dom-update | no | DOM update and configured head updates have completed. |
| boost:after-swap | no | Swap lifecycle has completed, including explicit script handler invocation. |

boost:before-dom-update and boost:after-dom-update carry
BoostDOMUpdateDetail: normal request/response detail plus target and incoming.
With the native replace strategy, incoming's child nodes are moved into target;
after the update, inspect target rather than expecting incoming to retain them.

## Head metadata

head: 'title' (default) updates document.title only.
head: 'metadata' also synchronizes a conservative allowlist:
description, keywords, author, robots, theme-color, application-name,
color-scheme and selected Open Graph properties.
head: false leaves all current head fields unchanged.

The engine does not copy response http-equiv metadata, CSP, charset, base,
links, stylesheets or scripts. It does not merge arbitrary head markup.

## Script handling and Trusted Types

Scripts in response descendants are removed before insertion. Inline event
handler attributes, srcdoc, and javascript: / vbscript: URL attributes are
also removed as defense in depth. The engine first checks the response source
for active-markup indicators and skips the DOM filtering traversal for
ordinary documents; this is not a general-purpose HTML sanitizer.

executeScripts is deprecated and ignored. To opt into application-specific
processing, provide scriptHandler. It receives detached script elements and
the update context (including the final URL and configured CSP nonce). The
handler is responsible for validating script sources, creating/inserting any
script elements, and obeying CSP. It may return a Promise; navigation does not
wait for that work, and asynchronous failures are reported without rolling
back the already-committed DOM. The engine itself never executes inline or
external response scripts.

For a page enforcing Trusted Types, createHTML can call the host application's
Trusted Types policy and return its TrustedHTML result to DOMParser.
boost-html does not create a policy and does not claim to sanitize content.
Under a strict Trusted Types CSP, returning a plain string may still be
rejected by the browser.

## History, scroll and accessibility

The History Engine uses the browser's native History API. A successful
navigation pushes a new entry by default; pass `{ push: 'replace' }` to replace
the current entry, or `{ push: false }` for a history traversal that must not
create another entry. A push to the current URL is converted to a replacement
to avoid duplicate entries. Redirects are committed using the final validated
same-origin URL, so the address bar follows the document that was rendered.
If a History API write fails after a swap, the engine starts a native navigation
to the final URL rather than leaving the address bar and content divergent.

Boost-owned entries are marked with a compact, versioned `__boostHtml` field
inside `history.state`. It stores the outgoing scroll offset and, when
available, the focused element's ID. Existing object state is copied forward
and retained. Non-plain application state values (for example arrays or
dates) are retained under `__boostHtmlOriginalState` when a wrapper is required. Only entries carrying
the boost marker are handled on `popstate`; entries owned by the browser or
another router are left alone.

When history and scroll management are enabled, the engine temporarily sets
`history.scrollRestoration = 'manual'` and restores the previous value on
`stop()`. It saves the outgoing entry before a push, restores the saved
position on back/forward, scrolls to a decoded hash target when present, and
otherwise scrolls to the top. Set `scroll: false` to leave scrolling to the
browser/application. Same-document hash links are not intercepted, preserving
native anchor behavior.

Focus defaults to automatic focus of the response's `main`, `[role="main"]`,
or `h1`, but only when the old focused element was removed. A hash target or
the previous entry's focused element ID takes precedence when available.
Configure `focus: '#selector'` or `focus: 'target'` to choose another target;
use `focus: false` to disable focus management. Persistent controls outside
the swap target retain focus and are not interrupted. Newly focused non-
interactive landmarks receive temporary `tabindex="-1"` which is removed
when focus leaves.

Successful navigations are announced through a visually hidden polite live
region (`role="status"`, `aria-live="polite"`). Set `announce: false` to
disable it. Native links and forms keep their browser keyboard activation and
tab order; boost-html delegates click and submit events rather than replacing
keyboard behavior. `stop()` removes the live region, listeners and restores
the previous scroll-restoration setting.

## Morph adapter evaluation

No morphing package is installed by boost-html. The adapter boundary is stable
enough to test candidates without changing the default bundle.

| Candidate | Performance evidence | Maintenance / license | Compatibility considerations |
| --- | --- | --- | --- |
| Idiomorph | Maintainers publish a manual benchmark suite comparing it with morphdom; the benchmarks are not run in CI, so no universal speed winner is assumed here. Its algorithm builds descendant ID sets to match across nested/reordered structures. | v0.8.0; 0BSD; npm metadata showed a release about a month before this audit. | Supports cross-document morphing and richer structural matching; useful where preserving nested node identity and form/focus state matters. Its algorithm does more matching work than a simple sibling-ID approach. |
| morphdom | Its project describes it as a fast real-DOM morphing library and maintains a benchmark suite. No project-specific boost-html comparison has been run. | v2.7.8; MIT; npm metadata showed a release about eight months before this audit. | Mature, widely adopted element-to-element adapter with a simpler matching model; keyed matching is primarily based on IDs among siblings, so deeply reordered trees may need explicit keys/hooks. |

Sources:
- https://github.com/bigskysoftware/idiomorph
- https://github.com/bigskysoftware/idiomorph/blob/main/PERFORMANCE.md
- https://github.com/bigskysoftware/idiomorph/releases
- https://github.com/patrick-steele-idem/morphdom
- https://www.npmjs.com/package/idiomorph
- https://www.npmjs.com/package/morphdom

**Decision:** keep native replacement as the default and do not add either
package now. boost-html's own benchmark currently measures full navigation
rather than morph-only DOM work, so it cannot justify a dependency. Before
selecting an adapter, benchmark replace, Idiomorph and morphdom against the
same representative boost-html response fixtures in Chromium, Firefox and
WebKit, measuring median/p95 update time, node identity/focus preservation,
and bundle cost. A future adapter can be installed by the application without
changing the default core.

## In-memory navigation cache

The optional navigation cache is configured on `createBoost()` and is disabled
by default:

```ts
const boost = createBoost({
  cache: {
    enabled: true,
    maxEntries: 20,
    maxAge: 30_000,
    exclude: ['/reports/private'],
  },
})

boost.clearCache()
boost.clearCache('/catalog')
```

The cache is a per-instance LRU of same-origin HTML GET responses. A response
must explicitly opt in with `Cache-Control: public`; `no-store`, `no-cache`,
`private`, stale `max-age` / `Expires` / `Age`, `Vary: Cookie`,
`Vary: *`, and untracked `Vary` headers prevent storage. The configured
`maxAge` is an upper bound, not an override of shorter server freshness.
Explicit request headers are included in the cache key, including
`Authorization`; browser-managed cookies cannot be inspected, so servers must
never mark user-specific responses public or set cookies on cacheable responses.

Sensitive path segments are excluded by default. Additional path prefixes can
be supplied with `exclude`; links can opt out with `data-no-cache` or
`data-cache="false"`. State-changing requests invalidate cache and prefetch
entries before and after the request. Call `boost.clearCache()` when
authentication or tenant context changes outside boosted navigation. When
prefetch is enabled, its eligible public responses are shared with the
navigation cache.
