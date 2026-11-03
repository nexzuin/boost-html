# Security audit and security model

**Audit scope:** browser-side navigation, fetched HTML parsing and insertion,
script handling, URL and redirect validation, forms, CSP / Trusted Types,
DOM clobbering exposure, and in-memory cache isolation.

**Audit status:** code review plus automated Vitest regression tests. This is
not a third-party penetration test, formal verification, or a guarantee that
all HTML injection payloads are neutralized. No browser-enforced CSP or Trusted
Types matrix has been completed yet; that is a release-readiness task.

## Executive summary

The current implementation has several important security boundaries:

- Boosted navigation accepts only same-origin `http:` and `https:` URLs.
- The final URL after Fetch redirects is checked before parsing, swapping, or
  committing history. A cross-origin or non-HTTP(S) redirect is rejected.
- Fetched `<script>` elements are removed from the selected response subtree.
  No response script is automatically inserted or executed. The deprecated
  `executeScripts` option is ignored.
- Response descendants are defensively filtered for inline event handlers,
  dangerous URL schemes, embedded browsing contexts, inline CSS, `srcset`,
  ping attributes, and customized built-in element selectors (`is`).
- Navigation and custom progress-template parsing use `DOMParser` and DOM node
  operations; runtime code does not use `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, `eval`, or `Function`.
- Response HTML must declare an HTML content type and is limited to 2 MiB by
  default. Non-idempotent form submissions are not automatically retried.
- Navigation cache is disabled by default and only stores explicitly public,
  fresh same-origin HTML responses that pass conservative `Vary` checks.

These controls are defense in depth. **boost-html is not a general-purpose HTML
sanitizer.** The server must not return attacker-controlled HTML as trusted page
markup. If the application needs to render arbitrary user-generated HTML, use a
vetted sanitizer such as DOMPurify with an application-specific policy before
returning it to boost-html.

## Findings and remediation

| ID | Severity | Finding / reproduction scenario | Status and remediation |
| --- | --- | --- | --- |
| SEC-01 | High (historical) | A same-origin endpoint redirected to a CORS-readable cross-origin HTML response. Swapping it while retaining the same-origin URL could display attacker-controlled content in the trusted origin. | **Fixed before this audit phase.** `resolveFinalUrl()` rejects a final URL with a different origin or non-HTTP(S) scheme before response parsing and DOM mutation. Regression coverage exists for cross-origin and non-HTTP(S) redirects. |
| SEC-02 | High (historical) | A caller invoked `navigate('javascript:...')`, `navigate('data:...')`, or a cross-origin URL; a failure fallback could otherwise pass an unsafe URL to browser navigation. | **Fixed before this audit phase.** Programmatic navigation validates scheme and origin before Fetch or fallback. Link and form interception also leave cross-origin destinations to native browser navigation. |
| SEC-03 | High (historical) | A fetched document contained inline or external `<script>` elements. | **Fixed before this audit phase.** Scripts are removed and execution is disabled by default. The legacy `executeScripts` option is ignored. Only an explicitly supplied `scriptHandler` receives detached script nodes. |
| SEC-04 | High | A response subtree contained `iframe`, `object`, `embed`, `portal`, a `<style>` element, `style` / `srcset` / `ping` attributes, or `data:` / other unsafe URL values. The previous filter concentrated on scripts, event attributes, and JavaScript URLs and did not cover all of these surfaces. | **Fixed in this audit.** The active-content filter now removes embedded browsing contexts and response style elements; strips inline event handlers, inline CSS, `srcset`, `ping`, `srcdoc`, and `is`; and applies a scheme allowlist to URL-bearing attributes. Only base64 raster image data URLs on `<img>` are retained. |
| SEC-05 | Medium | A custom progress template was parsed using `template.innerHTML`; under Trusted Types enforcement this was an unsafe HTML sink and could reject strings or accept unsafe configured markup. | **Fixed in this audit.** The template is parsed through `DOMParser`, passed through the host `createHTML` hook when supplied, and filtered before insertion. A Trusted Types policy is still the host application's responsibility. |
| SEC-06 | Low | An application-provided `scriptHandler` threw synchronously or rejected asynchronously after the DOM swap. | **Fixed in this audit.** The error is logged and emitted as a non-cancelable `boost:error` event. The already-completed DOM swap is not rolled back. |
| SEC-07 | Medium (residual) | An attacker can influence a same-origin HTML response containing custom elements registered by the host application. Their constructors or `connectedCallback` methods may run when the elements are adopted into the live document. | **Not fully mitigated.** Stripping every custom element would break legitimate component-based applications. Treat server-rendered custom elements as trusted application code; sanitize or reject user-controlled markup before it reaches the navigation response. |
| SEC-08 | Medium (residual) | A response contains attacker-controlled `id` or `name` values that collide with legacy named properties on `window`, `document`, or forms. | **Not fully mitigated.** The library does not use named global properties as security-sensitive references, but host application code may. Avoid named-property access for security-sensitive objects and use explicit references / `getElementById()` / scoped selectors. |
| SEC-09 | Medium (residual) | An application uses `createHTML` as a pass-through function or an explicit `scriptHandler` that inserts untrusted scripts. | **Host responsibility.** Neither hook is a sanitizer. A permissive Trusted Types policy or script handler can reintroduce injection by design. Use a vetted sanitizer, source allowlists, nonce / CSP controls, and narrowly scoped policies. |
| SEC-10 | Medium (residual) | A server marks user-specific or cookie-dependent HTML as `Cache-Control: public` without correct `Vary` headers, or a user changes session / tenant context without clearing the in-memory cache. | **Partially mitigated; server and host contract required.** Cache is opt-in, per instance, and rejects `private`, `no-cache`, `no-store`, `Vary: Cookie`, `Vary: *`, and unrepresented `Vary` headers. JavaScript cannot inspect HttpOnly cookies, so only mark truly user-independent responses public. Call `clearCache()` after external auth or tenant changes. |
| SEC-11 | Medium (residual) | A malicious site causes a user to submit a state-changing form, or the server trusts `X-Requested-With` / `HX-*` headers as CSRF protection. | **Server responsibility.** Boosted forms use same-origin credentials and only intercept same-origin `GET` / `POST`; this does not replace CSRF tokens, Origin validation, authorization, or server-side input validation. |

Historical findings above describe issues in earlier revisions and are listed
to preserve the audit trail; they are not claims that those vulnerabilities are
present in the audited commit.

## Explicit security boundaries

### URL and redirect policy

- Only `http:` / `https:` URLs whose origin matches `window.location.origin`
  are eligible for programmatic boosted navigation.
- URL credentials (`username` / `password`) are rejected for boosted
  navigation, final redirect URLs, and cache eligibility. Do not embed them in
  navigation URLs.
- Cross-origin links and forms are not intercepted; the browser handles them
  as normal top-level navigation or form submission.
- Fetch follows redirects, but the final `Response.url` (or the validated
  cached final URL) is checked for HTTP(S) and same-origin before parsing.
- A rejected GET navigation may fall back to a native top-level navigation to
  the originally requested same-origin URL. The browser then applies its normal
  address-bar and origin rules. Non-idempotent forms are not retried unless the
  host explicitly opts into `fallbackToNativeForm`, which can duplicate work.

### HTML parsing and DOM insertion

The response is parsed into a separate document. The configured target is
resolved in both documents and validated before a swap. The built-in native
strategy moves nodes with `replaceChildren`; it does not serialize a response
subtree back into an HTML string. `head: 'metadata'` only copies a fixed
allowlist of descriptive meta fields and never imports response CSP, `base`,
`http-equiv`, stylesheet, link, or script elements.

The active-content filter is a deliberately conservative compatibility tradeoff:

- Removes response scripts, iframe/frame/object/embed/portal elements, and
  style elements from the selected subtree.
- Removes all inline `on*` attributes, `srcdoc`, customized built-in `is`,
  `style`, `srcset`, and `ping` attributes.
- Allows `http:` / `https:` URLs on supported URL attributes; allows `mailto:`
  and `tel:` only for link-like `href` attributes.
- Allows base64 PNG, GIF, JPEG, WebP, and AVIF data URLs only on `<img>`.
  Other `data:` URLs, SVG data URLs, `javascript:`, `vbscript:`, `file:`, and
  unrecognized schemes are removed.

This is not a complete sanitizer for HTML, SVG, MathML, custom elements,
clobbering, CSS, or browser parser edge cases. It must not be used as the sole
control for user-generated HTML.

### Script execution

Script execution is disabled by default and there is no implicit re-execution
of response scripts. `executeScripts` is deprecated and ignored. If the host
supplies `scriptHandler`, it receives detached script nodes after filtering;
that hook is a privileged application boundary. The handler must validate
source URLs and script contents, apply CSP / nonce policy, and avoid executing
attacker-controlled content. Handler failures are reported through
`boost:error`; the swap is already committed and is not rolled back.

### CSP and Trusted Types

- No runtime use of `eval`, `Function`, `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, or `document.write` is intended. Regression tests scan
  runtime TypeScript sources for these sinks.
- `nonce` is applied to the progress stylesheet and included in the DOM update
  context for an explicit script handler.
- Under `require-trusted-types-for 'script'`, supply `createHTML` that returns
  a `TrustedHTML` value from a host-owned policy for response and custom
  progress-template parsing. A plain string may be rejected by the browser.
- `createHTML` does not sanitize content. Do not create a permissive default
  policy merely to silence Trusted Types violations.
- A strict `style-src` policy may block progress styles unless it permits the
  nonce. The library does not weaken CSP or add policy directives.
- Real-browser CSP and Trusted Types enforcement remains to be verified in the
  multi-engine production test phase; jsdom tests are not equivalent to browser
  policy enforcement.

### Forms and request integrity

- Only `GET` and `POST` are boosted; `dialog` submissions remain native.
- Cross-origin actions, non-`_self` targets, downloads, and modified link
  clicks are left to the browser.
- Form encoding respects `application/x-www-form-urlencoded`, `text/plain`,
  and `multipart/form-data`; multipart boundaries are left to Fetch.
- `credentials: 'same-origin'` is used. This is not CSRF protection.
- Failed `POST` requests are not automatically replayed. Enabling
  `fallbackToNativeForm` explicitly accepts the risk of duplicate server-side
  effects after an ambiguous network failure.
- The server must validate CSRF tokens / Origin, authorization, content types,
  file size and type, and all submitted values.

### Navigation cache isolation

The optional in-memory navigation cache is disabled by default. It is per
`createBoost()` instance, stores only status-200 same-origin HTML responses
explicitly marked `Cache-Control: public`, respects freshness directives and
`Vary`, and rejects `private`, `no-cache`, `no-store`, `Vary: Cookie`, `Vary: *`,
and `Vary` fields that are not represented by explicit request headers.
Sensitive route segments are excluded by default. `Authorization` is included
in the explicit request-header cache key.

Browsers do not expose HttpOnly `Cookie` request headers or `Set-Cookie`
response headers to page JavaScript. Therefore the cache cannot independently
prove that a response is safe to reuse across sessions. The server must only
mark content `public` when it is genuinely identical and reusable across users,
must not set cookies on such responses, and must set correct `Vary` directives.
The host must call `clearCache()` when authentication, user, or tenant context
changes outside a boosted state-changing request.

## Automated regression coverage

The security-focused regression tests cover:

- scripts, inline event handlers, entity-obfuscated JavaScript URLs, nested
  template content, SVG URL attributes, embedded browsing contexts, inline
  CSS, `srcset`, ping, unsafe `data:` URLs, form action overrides, and safe
  `mailto:` / raster image exceptions;
- custom response targets including `<head>`;
- default script non-execution and explicit script-handler behavior;
- same-origin / cross-origin / non-HTTP(S) navigation and redirect handling;
- cache `Vary`, Authorization keying, public freshness and sensitive-route
  exclusions;
- Trusted Types hook invocation and custom progress-template filtering;
- static guardrails against dynamic evaluation and HTML string mutation sinks;
- script-handler failure reporting.

Run with:

```bash
npm test
npm run typecheck
npm run lint
```

The current audit phase completed with 148 Vitest tests passing. This result
proves only that the current regression suite passes in its test environment;
it does not establish that all XSS payloads, browser quirks, custom elements,
DOM clobbering, CSP combinations, or host application vulnerabilities have
been eliminated.

## Operational recommendations

1. Keep `cache.enabled` false unless the server can guarantee truly public,
   user-independent HTML responses.
2. Keep `scriptHandler` unset unless there is a concrete, reviewed need.
3. Keep `createHTML` tied to a host-owned, restrictive Trusted Types policy.
4. Use server-side output encoding and a vetted sanitizer for user-generated
   HTML before it becomes a navigation response.
5. Deploy a strict CSP with nonces or hashes; do not treat CSP as a replacement
   for output encoding or server authorization.
6. Implement CSRF protection and authorization on every state-changing route.
7. Clear the navigation cache after login, logout, account switching, or tenant
   switching.
8. Test the complete application in real Chromium, Firefox, and WebKit builds
   with its actual CSP / Trusted Types headers before production deployment.

## Vulnerability reporting

Please report suspected vulnerabilities privately through the repository's
GitHub Security tab / private vulnerability reporting. Do not publish an
unfixed exploit in a public issue. Include the affected commit, browser and
version, reproduction steps, expected and observed behavior, and impact.
