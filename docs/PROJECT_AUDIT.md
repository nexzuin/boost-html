# Project Audit — `boost-html`

**Status:** Audit at time of writing. No source, test, build, or configuration
files were modified while producing this document. Phase 0 (guardrails) and
Phase 1 (security P0) from section 13 were implemented after the audit was
approved; see `CHANGELOG.md` for the resulting behavior changes. The findings
below remain the pre-implementation baseline.

**Audited revision:** working tree as inspected on 2026-11-02 (version
`0.1.0`, not a Git repository, no release tags).

**Benchmark / test environment:** Node `24.21.0`, npm `11.19.0`, Linux.
Measurements are from this machine unless stated otherwise.

**Reference architecture:** `AGENTS.md` (project mission, architecture
boundaries, security rules, performance requirements, testing standards,
package requirements). `README.md` describes the public contract as currently
implemented. `BOOST_HTML.md` is the original prototype that the implementation
was derived from.

---

## 1. Executive summary

`boost-html` is a working `hx-boost`-style navigation library with a small,
readable implementation, a clean ESM/CJS/IIFE export map, 29 passing
jsdom tests, and a demo server. The current code already handles a number of
details that the original prototype missed (redirect final URL, hash
preservation, 204 responses, aborting stale requests, script deduplication).

It is **not yet production-ready** against the project's own stated bar
(`AGENTS.md`):

1. **Script execution is enabled by default** (`executeScripts: true`), which
   `AGENTS.md` explicitly forbids.
2. **Redirect destinations are not validated for origin/protocol**, so a
   same-origin request that redirects to a CORS-permitted cross-origin host can
   swap attacker-controlled HTML and execute its scripts while the address bar
   still shows the original origin. This was reproduced against the built
   bundle.
3. **The public `navigate()` API has no URL policy**; a `javascript:` URL reaches
   `location.assign()` through the failure fallback.
4. **There is one mandatory runtime dependency (`nprogress`)** — roughly 30% of
   the minified bundle — which violates the zero-dependency goal. The full
   minified ESM build is **5.33 KB gzip**, above the 5 KB target; the core
   without NProgress is **3.46 KB gzip**.
5. **No real-browser tests, no CI, no lint/format, no benchmarks, no bundle-size
   gate**, and the repository is not under version control.

### Finding counts (this audit)

| Area | 🔴 Critical | 🟠 High | 🟡 Medium | ⚪ Low |
| --- | --- | --- | --- | --- |
| Security | 1 | 4 | 4 | 4 |
| Correctness / compatibility | 0 | 2 | 8 | 10 |
| Performance | 0 | 3 | 3 | 3 |
| Architecture / memory | 0 | 2 | 6 | 11 |
| Testing / packaging / docs | 0 | 3 | 16 | 15 |
| **Total** | **1** | **14** | **37** | **43** |

### Top priorities

| Rank | Finding | Why |
| --- | --- | --- |
| 1 | `SEC-01` unvalidated redirect final URL | Direct path to XSS with a same-origin URL bar |
| 2 | `SEC-02` unrestricted programmatic navigation | `javascript:` fallback and cross-origin swaps |
| 3 | `SEC-03` scripts executed by default | Violates the repository's security contract |
| 4 | `SEC-04`/`SEC-05` no sanitization claim, no CSP nonce / Trusted Types | "Scripts off" still leaves active inline handlers |
| 5 | `PKG-01` / `PERF-02` mandatory NProgress | Zero-dep and size goals; also eager optional subsystem |
| 6 | `PERF-01` double HTML parse + serialize | Largest per-navigation CPU cost on large pages |
| 7 | `COR-01`/`COR-02` incomplete form semantics | Wrong URL/method/encoding for valid HTML forms |
| 8 | `TEST-01` no real-browser tests | History, scroll, CSP and script behavior are unverified |

**Recommendation:** do **not** rewrite the library. Harden the security-critical
paths in place first, add guardrails (CI, lint, size gate, Playwright), then
extract the monolithic controller incrementally while preserving the documented
public API. The refactoring strategy and phased plan are in sections 9–10.

---

## 2. Audit method and evidence

Inspected:

- `package.json`, `package-lock.json`, `.gitignore`, `README.md`, `AGENTS.md`,
  `BOOST_HTML.md`, `LICENSE`
- `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- `src/index.ts`, `src/boost.ts`, `src/dom.ts`, `src/progress.ts`,
  `src/types.ts`
- `tests/auto-init.test.ts`, `tests/boost.test.ts`
- `demo/server.mjs`
- `dist/` output, npm pack contents, dependency tree, npm audit
- Repository state (no `.git`, no `.github`, no lint/format/coverage config)

Commands executed (all succeeded unless noted):

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | 29 tests pass, 2 files, ~1.9 s |
| `npm run build` | Pass (ESM/CJS/IIFE + `.d.ts`/`.d.cts`) |
| `npm pack --dry-run` | 11 files, 45.8 kB tarball, 187.6 kB unpacked |
| `npm audit` / `npm audit --omit=dev` | 0 vulnerabilities |
| `npm ls --omit=dev --all` | `nprogress@0.2.0` (single prod dependency) |
| esbuild metafile analysis | Per-module bundle contribution (section 7) |
| jsdom probes against `dist/index.global.js` | Redirect, multi-instance popstate, form overrides, script policy |

### Audit limitations

- No real browser was available in this environment. Browser-history, layout,
  CSP, Trusted Types, CORS and real script-loading behavior were assessed from
  code and jsdom probes, not from Chromium/Firefox/WebKit runs.
- jsdom probes use mocked `fetch`; they prove library logic, not browser CORS
  enforcement. The redirect finding is therefore **conditional on the redirect
  target being readable by `fetch`** (CORS-permitted), which is common for
  public endpoints/CDNs.
- No baseline performance benchmark was executed. Bundle sizes are measured;
  runtime speed is not.
- The repository is not under version control, so no diff/history/blame or
  released-version compatibility analysis was possible.

---

## 3. Current architecture

### 3.1 Repository layout

```text
.
├── AGENTS.md                 # repository-wide engineering/security contract
├── BOOST_HTML.md             # original prototype (reference only)
├── LICENSE                   # MIT
├── README.md                 # public usage/docs
├── package.json              # v0.1.0, ESM-first, 1 runtime dependency
├── package-lock.json
├── tsconfig.json             # strict, ES2022 lib, noEmit
├── tsup.config.ts            # ESM + CJS + IIFE, dts, sourcemaps
├── vitest.config.ts          # jsdom, tests/**/*.test.ts
├── src/
│   ├── index.ts              # browser auto-init + public exports
│   ├── boost.ts              # controller: interception, fetch, swap, history, scroll
│   ├── dom.ts                # HTML response checks, swap, script re-execution, scroll helpers
│   ├── progress.ts           # NProgress wrapper + injected CSS
│   └── types.ts              # public option/detail/instance types
├── tests/
│   ├── boost.test.ts         # 27 behavior tests
│   └── auto-init.test.ts     # 2 auto-init tests
├── demo/server.mjs           # demo server (not published)
└── dist/                     # generated, gitignored
```

No `.git`, `.github/`, `docs/`, lint config, formatter config, coverage config,
or benchmark directory exists.

### 3.2 Runtime module graph

```text
src/index.ts
  ├── createBoost() ──────────────► src/boost.ts
  │                                    ├── src/dom.ts
  │                                    └── src/progress.ts ──► nprogress
  └── auto-start instance + window.boostHtml

src/types.ts  (types only)
```

The module graph is acyclic and small. `boost.ts` is the only stateful module;
`dom.ts`, `progress.ts` and `types.ts` are stateless/utility (with a
module-level `stylesInjected` flag in `progress.ts`).

### 3.3 Navigation data flow (current)

1. Delegated `click` / `submit` listener on `document`; `popstate` on `window`
   (`src/boost.ts:102-104`).
2. Click eligibility: boosted ancestor/self, same origin, no hash-only target,
   no `download`/`target`/`rel="external"`, no modifier/non-primary click
   (`src/boost.ts:262-296`).
3. Form eligibility: boosted, no `target`, method normalized to GET/POST,
   same-origin action (`src/boost.ts:298-327`).
4. `navigate()` aborts the previous controller, assigns a new
   `AbortController`, builds headers, dispatches `boost:before-request`
   (`src/boost.ts:131-165`).
5. `fetch(url, { credentials: 'same-origin', redirect: 'follow' })`
   (`src/boost.ts:167-173`).
6. Status check (204/205 no-op), `response.ok`, content-type check
   (`src/boost.ts:177-183`, `src/dom.ts:11-14`).
7. Read full text, parse with `DOMParser`, compute final URL from
   `response.url` (hash patch), dispatch `boost:before-swap`
   (`src/boost.ts:185-197`).
8. Snapshot existing external script URLs, remember scroll, replace
   `target.innerHTML` with `doc.body.innerHTML`, update `document.title`,
   commit history (`src/boost.ts:199-208`, `src/dom.ts:28-31`).
9. Apply scroll (restore or top/hash), re-execute scripts sequentially
   (default on), dispatch `boost:after-swap`
   (`src/boost.ts:210-217`, `src/dom.ts:37-87`).
10. On failure: dispatch `boost:error`; unless canceled, fall back to native
    form submit or `location.assign()` (`src/boost.ts:219-225, 386-399`).

### 3.4 Lifecycle

- `createBoost(options)` creates an independent controller; it does not start
  automatically.
- Importing `src/index.ts` in a browser **creates and starts** a controller and
  assigns `window.boostHtml` (`src/index.ts:15-19`).
- `start()` is idempotent via a boolean; attaches three listeners, sets
  `history.scrollRestoration = 'manual'` when history+scroll are enabled
  (`src/boost.ts:95-112`).
- `stop()` detaches listeners, aborts the current request, restores the saved
  `scrollRestoration` value (`src/boost.ts:114-128`).
- There is no `configure()`, `isStarted`, `destroy()` alias, or global
  instance registry.

### 3.5 Public API inventory

| Export / global | Kind | Implemented behavior |
| --- | --- | --- |
| `createBoost(options?)` | function | Creates an independent controller |
| `getBoost()` | function | Returns the auto-created instance or `null` outside a browser |
| `window.boostHtml` | global | Auto-created instance |
| `window.boostHtmlConfig` | global | Read once at module evaluation; no runtime reconfiguration |
| `Boost.start()` / `Boost.stop()` | methods | Attach/detach listeners; stop aborts and restores scroll restoration |
| `Boost.navigate(url, options?)` | method | Programmatic navigation; resolves `boolean` |
| `Boost.options` | property | Resolved options object (mutable at runtime) |
| `data-boost="true"` / `"false"` | HTML attributes | Opt-in scope / opt-out subtree |
| `boost:before-request`, `before-swap`, `after-swap`, `error` | DOM events | Dispatched on `document`, bubble; first two cancelable |
| Types | TypeScript | Options, navigate options, event detail objects, resolved options |

### 3.6 Build and package state

- `tsup` (esbuild) builds ESM, CJS, and IIFE + declarations + sourcemaps.
- `package.json` exports map is correct for ESM and CJS (`.d.ts`/`.d.cts`
  split), and `npm pack` contains only `dist`, `README`, `LICENSE`.
- IIFE/`unpkg`/`jsdelivr` entry is **unminified**.
- `sideEffects: ["dist/*"]` marks the whole published output side-effectful.
- `prepublishOnly` runs only `npm run build`.
- No `repository`, `homepage`, `bugs`, `publishConfig`, or CI.

### 3.7 Test and tooling state

- 29 passing tests: link interception, opt-out, skip rules, GET/POST forms,
  fallbacks, cancellation, script re-execution/dedupe, redirect history, 204,
  abort-on-stop, non-HTML responses, progress styles, auto-init.
- jsdom only; no Playwright or browser matrix.
- No coverage reporting/threshold, no type tests, no lint/format scripts.
- Two test-hygiene issues: `Element.prototype.scrollIntoView` is replaced and
  not restored; the progress-style assertion depends on module-level
  `stylesInjected` and test order.
- Auto-init tests dynamically import `src/index.ts` repeatedly and never stop
  those instances; listeners leak within the test process.

---

## 4. Feature inventory

Legend: **[I]** implemented, **[P]** partial, **[N]** not implemented,
**[P-opt]** proposed optional feature (not present).

### 4.1 Navigation

| Capability | State | Evidence / notes |
| --- | --- | --- |
| Opt-in boosted subtrees via `data-boost="true"` | [I] | `src/boost.ts:56, 259-261` |
| Opt-out via `data-boost="false"` | [I] | `src/boost.ts:259` |
| Same-origin-only link interception | [I] | `src/boost.ts:284` |
| Skip external hosts | [I] | origin comparison |
| Skip `target` (except `_self`), `download`, `rel="external"` | [I] | `src/boost.ts:272-279` |
| Skip modifier keys / non-primary buttons | [I] | `src/boost.ts:262-264` |
| Skip same-document hash links | [I] | `src/boost.ts:287-290` |
| Preserve URL hash from request | [I] | `src/boost.ts:31-49, 191` |
| Abort stale request / latest-wins | [I] | `src/boost.ts:139-141, 174-186` |
| Hard fallback on link failure | [I] | `src/boost.ts:386-399` |
| Programmatic `navigate()` | [P] | Implemented, but no URL policy and only boolean result |
| Back/forward refetch | [I] | `src/boost.ts:333-338` |
| Avoid duplicate history commits | [P] | Basic push/replace; cross-origin redirect commit can fail silently |
| Prefetch | [N] | Not present |
| Cache (memory) | [N] | Not present |
| Morph / partial swap | [N] | Body replacement only |

### 4.2 Forms

| Capability | State | Evidence / notes |
| --- | --- | --- |
| GET forms → query string | [I] | `src/boost.ts:321-324` |
| POST forms → `FormData` | [I] | `src/boost.ts:325-330` |
| Submitter name/value | [I] | `src/boost.ts:311-313` |
| File uploads in POST | [I] | Native `FormData(form)` |
| File input in GET | [P] | File value becomes `[object File]` instead of filename |
| `formaction` / `formmethod` on submitter | [N] | Probe: POST `/a` instead of GET `/b` |
| `formenctype` / `formtarget` on submitter | [N] | Ignored; form-level `target` only |
| Form `enctype` honored | [N] | Always `multipart/form-data` via `FormData` |
| Image submit coordinates (`name.x`, `name.y`) | [N] | Not added |
| Unknown method normalized to GET | [I] | Matches browser behavior |
| `method="dialog"` skipped | [I] | `src/boost.ts:302-303` |
| Cross-origin form → native submit | [I] | `src/boost.ts:307-308` |
| Native fallback on failure | [I] | `src/boost.ts:387-394`; may duplicate non-idempotent POSTs |
| Duplicate-submission protection | [N] | Two rapid submits issue two requests (latest aborts previous fetch, but server may already have received it) |

### 4.3 Response / DOM

| Capability | State | Evidence / notes |
| --- | --- | --- |
| 204/205 no-op | [I] | `src/boost.ts:177` |
| `response.ok` validation | [I] | `src/boost.ts:178-180` |
| HTML content-type validation | [P] | Missing content-type is accepted as HTML |
| `DOMParser` parsing | [I] | `src/boost.ts:190` |
| Body replacement | [I] | `src/dom.ts:28-31` via `innerHTML` |
| Title update | [I] | `src/boost.ts:207`; empty titles ignored |
| Head updates (other than title) | [N] | Documented limitation |
| Body/html attribute sync (`class`, `lang`, `dir`) | [N] | Not implemented |
| `<base>` handling | [N] | New body resolves against old base |
| Script execution | [I] | Default **on**; inline + external; sequential; 5 s timeout |
| External script dedupe | [I] | Snapshot of currently loaded `script[src]` |
| Async/defer/module semantics | [P] | Re-created sequentially; timing changes |
| Inline event-handler attributes | [N] | Survive `innerHTML`; active in browsers even with scripts off |
| Sanitization | [N] | None (not claimed in README) |
| CSP nonce support | [N] | Not implemented for injected style or re-executed scripts |
| Trusted Types support | [N] | `innerHTML` string assignment; breaks under `require-trusted-types-for 'script'` |
| Response size limit | [N] | Entire body buffered and parsed |
| Missing-target precheck | [N] | Detected after fetch; triggers fallback |

### 4.4 History, scroll, accessibility

| Capability | State | Evidence / notes |
| --- | --- | --- |
| `pushState` / `replaceState` | [I] | `src/boost.ts:351-366` |
| Popstate refetch without pushing | [I] | `push: false` |
| Redirect final URL committed | [I] | `src/boost.ts:191, 356-360`; no origin validation |
| Scroll position stored per history entry | [I] | `boostScrollY` in state |
| Scroll restore on back/forward | [I] | `src/boost.ts:370-385` |
| Hash anchor scroll | [I] | `scrollToHash`, runs before scripts |
| `history.scrollRestoration = 'manual'` | [I] | Global mutation; multi-instance restore ordering is fragile |
| Focus management after swap | [N] | Focus is lost with the replaced subtree |
| `aria-busy` / live announcements | [N] | Not implemented |
| `lang` / `dir` sync | [N] | Not implemented |
| bfcache / `pageshow` handling | [N] | Popstate always refetches |

### 4.5 Progress, events, lifecycle

| Capability | State | Evidence / notes |
| --- | --- | --- |
| NProgress bar | [I] | Mandatory import; bundled into all formats |
| Auto-injected progress CSS | [I] | `<style>` without nonce |
| Disable progress | [I] | `progress: false` |
| Configurable progress | [P] | NProgress options subset; only configure-on-start |
| Lifecycle events | [I] | Four events, all on `document` |
| Typed event map / `DocumentEventMap` augmentation | [N] | Consumers must cast `event as CustomEvent` |
| `start()` idempotent | [I] | Boolean guard |
| `stop()` aborts + restores scrollRestoration | [I] | Restore is per-instance, not reference-counted |
| Multi-instance coordination | [P] | Click/submit deduped by a symbol on the event; popstate is not |

### 4.6 Packaging, quality, documentation

| Capability | State | Evidence / notes |
| --- | --- | --- |
| ESM + CJS + IIFE + declarations | [I] | `tsup.config.ts`; exports map correct |
| Sourcemaps | [I] | Included in `npm pack` |
| Minified CDN bundle | [N] | `unpkg`/`jsdelivr` point to unminified IIFE |
| Zero runtime dependencies | [N] | `nprogress@0.2.0` |
| Side-effect-free core entry | [N] | Root import auto-starts |
| CI / browser matrix | [N] | No `.github`, no Playwright |
| Lint / format | [N] | No config or scripts |
| Coverage thresholds | [N] | No coverage tooling |
| Bundle-size gate | [N] | No size-limit/bundlewatch |
| Benchmarks | [N] | None |
| Security docs / threat model | [N] | README mentions CSP only as a limitation |
| Browser support matrix | [N] | Not documented |
| Changelog / migration guide | [N] | None |
| Demo server | [I] | `demo/server.mjs` (not published) |

---

## 5. Security assessment

### 5.1 Threat model

- **Assets:** same-origin session cookies, CSRF tokens, DOM integrity, user
  credentials, third-party script state, history/URL trust.
- **Trust boundary:** fetched HTML is server-controlled. A full browser
  navigation also trusts same-origin HTML, but this library additionally:
  swaps content without changing the address bar, can be pointed at endpoints
  not intended for top-level navigation, and re-executes scripts.
- **Adversaries / failure modes:** open redirects, compromised or
  user-content same-origin endpoints, cross-origin services with permissive
  CORS, stored/reflected XSS in fetched HTML, malicious inline event handlers,
  CSP/TT misconfiguration caused by the library, and app code passing
  untrusted URLs to `navigate()`.
- **Out of scope:** sanitizing application-generated HTML (the library is not a
  sanitizer); server-side CSRF/authorization; TLS.

### 5.2 Security findings summary

| # | Severity | ID | Location | Finding | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 🔴 CRITICAL | SEC-01 | `src/boost.ts:167-193, 356-365` | Cross-origin redirect destination is parsed, swapped, and its scripts executed without final-URL origin validation; history commit failure is swallowed | 9/10 |
| 2 | 🟠 HIGH | SEC-02 | `src/boost.ts:131-135, 386-399` | `navigate()` accepts any URL/scheme; failure fallback calls `location.assign(url)`, so a `javascript:` URL can execute | 9/10 |
| 3 | 🟠 HIGH | SEC-03 | `src/boost.ts:62, 199-216`; `src/dom.ts:37-87` | Scripts from fetched documents execute by default, contrary to `AGENTS.md` §7 | 10/10 |
| 4 | 🟠 HIGH | SEC-04 | `src/dom.ts:28-31` | `executeScripts: false` does not sanitize; inline `on*` handlers and `javascript:` URLs remain active | 10/10 |
| 5 | 🟠 HIGH | SEC-05 | `src/progress.ts:20-29`; `src/dom.ts:30` | No CSP nonce or Trusted Types support; inline `<style>` and `innerHTML` break hardened CSP | 9/10 |
| 6 | 🟡 MEDIUM | SEC-06 | `src/dom.ts:11-14` | Missing `Content-Type` is treated as HTML | 9/10 |
| 7 | 🟡 MEDIUM | SEC-07 | `src/boost.ts:185-190` | No response-size limit; full body buffered and parsed | 8/10 |
| 8 | 🟡 MEDIUM | SEC-08 | `src/boost.ts:217-225, 386-394` | Network/HTTP failure of a boosted POST triggers a native re-submit, violating the no-automatic-retry rule for non-idempotent actions | 8/10 |
| 9 | 🟡 MEDIUM | SEC-09 | `src/boost.ts:325-330` | Forms always sent as multipart; `enctype` ignored, which can change server/WAF/CSRF parsing behavior | 9/10 |
| 10 | ⚪ LOW | SEC-10 | `src/boost.ts:356` | `history.state` spread without an object guard | 8/10 |
| 11 | ⚪ LOW | SEC-11 | `src/dom.ts:11-14` | Permissive media-type regex (`text/htmlfoo` matches) | 8/10 |
| 12 | ⚪ LOW | SEC-12 | `src/progress.ts:20-29` | Fetched markup can pre-empt the progress style id; injected style persists after `stop()` | 7/10 |
| 13 | ⚪ LOW | SEC-13 | `src/boost.ts:214` | Script failures logged to console with details | 7/10 |

### 5.3 Detailed security findings

#### SEC-01 — Unvalidated redirect destination (CRITICAL)

**Evidence.** `fetch` follows redirects (`src/boost.ts:167-173`). The final URL
is taken from `response.url` (`:191`) and used for history, but no origin or
protocol check is performed before parsing (`:190`), swapping (`:207`) and
executing scripts (`:210-216`). History commit failures are swallowed
(`:351-365`).

**Reproduced** with the built IIFE in jsdom:

```text
requested: http://localhost/same-origin
navigate() -> true
swapped content: "external content"
injected <script> executed: "executed"
address bar still: http://localhost/
```

**Preconditions.** In a real browser the cross-origin response must be readable
by `fetch` (CORS allowed, or a same-origin endpoint with a redirect to a host
that sends permissive CORS headers). Public APIs/CDNs commonly do. A single
open redirect on the origin is then sufficient for DOM/script injection under
the original origin's URL.

**Impact.** Stored/reflected XSS-like content injection, credential phishing
inside a trusted origin, and script execution with access to same-origin
storage/cookies (subject to cookie flags), while the URL bar is unchanged.

**Recommended fix (surgical, Phase 1).** After `fetch` resolves and before
reading the body, compute `new URL(response.url || url.href)` and require:

- protocol is `http:` or `https:`;
- `origin === location.origin`;
- optionally reject `response.type` values other than `basic`/`default` for
  boosted navigation.

Throw on violation so the existing `boost:error` + hard-navigation fallback
runs: a real navigation changes the address bar and lets the browser enforce
origin boundaries. Add tests for same-origin redirect (allowed), cross-origin
redirect (rejected), protocol change (rejected), and unchanged URL/history on
rejection.

**Compatibility.** Rejecting cross-origin redirects is a behavior change for
apps that relied on it; it is a security fix and should be documented in the
changelog.

#### SEC-02 — Unrestricted programmatic navigation (HIGH)

**Evidence.** `navigate()` resolves any string/`URL` (`src/boost.ts:131-135`),
fetches it, and on failure calls `window.location.assign(url)`
(`src/boost.ts:386-399`). There is no scheme allowlist and no same-origin check.
`location.assign('javascript:...')` executes script in the page context in
browsers. Cross-origin URLs are also fetched (CORS permitting) and swapped.

**Recommended fix.** Enforce `http:`/`https:` and same-origin by default in
`navigate()`; add an explicit `allowCrossOrigin?: boolean` only if a concrete
use case emerges (still scheme-limited). Never pass a non-http(s) URL to
`location.assign`; reject with a typed failure reason.

**Compatibility.** Apps passing cross-origin URLs would break; the current
README does not document cross-origin navigation as supported.

#### SEC-03 — Scripts execute by default (HIGH)

**Evidence.** `executeScripts: options.executeScripts ?? true`
(`src/boost.ts:62`), execution at `:199-216`, implementation in
`src/dom.ts:37-87`. README advertises and documents the default (`README.md`
feature list and options table). A test asserts execution
(`tests/boost.test.ts:232`).

**Impact.** Re-runs analytics/payment/widget scripts, can double-count events,
can execute inline scripts from any same-origin endpoint, and expands the blast
radius of SEC-01/SEC-04. Directly contradicts `AGENTS.md` §7 ("Do not execute
scripts from fetched documents by default").

**Recommended fix.** Default to `false`; keep an opt-in
`executeScripts: true` with documented risks. Add a regression test that inline
scripts do not execute by default. This is an intentional breaking security
default; ship with a clear migration note (pre-1.0 minor bump or major bump per
policy).

#### SEC-04 — "Scripts off" is not sanitization (HIGH)

**Evidence.** Swapping uses `target.innerHTML = doc.body.innerHTML`
(`src/dom.ts:28-31`). A probe with `executeScripts: false` showed that
`onerror="..."` attributes and `javascript:` hrefs from the response remain in
the DOM. `innerHTML` never strips inline event-handler attributes; browsers
execute them on interaction/error. `<script>` elements inserted via
`innerHTML` are inert, but that is not sanitization.

**Impact.** Applications may treat `executeScripts: false` as a safety switch.
It is not. Same-origin HTML is normally trusted for full navigations, but this
library fetches documents from endpoints that may not be intended for top-level
rendering (user content, JSON-ish endpoints returning HTML, error pages).

**Recommended fix.** Document explicitly that the library performs no
sanitization and that fetched HTML is trusted only as much as a full page load;
optionally provide an opt-in sanitizer/Trusted Types policy hook. Do not claim
safety in README/API docs. Add regression documentation and tests for the
documented policy.

#### SEC-05 — CSP nonce / Trusted Types (HIGH)

**Evidence.** Progress CSS is injected as a `<style>` text node without a nonce
(`src/progress.ts:20-29`). Body replacement uses string `innerHTML`
(`src/dom.ts:30`), which throws under
`Content-Security-Policy: require-trusted-types-for 'script'`. Re-executed
scripts copy attributes (including `nonce` if the server provided one), but
there is no library-level nonce option.

**Impact.** The library fails on hardened sites or forces teams to weaken CSP.
With SEC-04, users may incorrectly believe disabling scripts makes the swap
safe.

**Recommended fix.** Add `nonce?: string` (or `getNonce?: () => string`) for
injected styles; replace `innerHTML` with node adoption/`replaceChildren`
(section 7) to avoid Trusted Types violations; document CSP requirements and
test under a CSP header in Playwright.

#### SEC-06 / SEC-07 / SEC-08 / SEC-09 (MEDIUM)

- **SEC-06:** `isHtmlResponse` returns `true` when the header is absent
  (`src/dom.ts:11-14`). Require an explicit HTML type, or validate a safe
  prefix, before parsing/swapping.
- **SEC-07:** `response.text()` buffers the whole body; a very large or
  malicious same-origin response can block the main thread and consume memory.
  Consider a configurable byte limit (streaming reader or `Content-Length`
  check) with a documented default.
- **SEC-08:** The POST fallback re-submits natively after any error, including
  ambiguous network failures where the server may already have processed the
  request. This conflicts with `AGENTS.md` §6. Prefer surfacing `boost:error`
  and let the application decide, or restrict fallback to cases where the
  request definitely was not processed. This is a product/security decision.
- **SEC-09:** `new FormData(form)` always produces multipart, ignoring
  `enctype="application/x-www-form-urlencoded"` and `text/plain`
  (`src/boost.ts:325-330`). This changes server parsing and can bypass
  middleware that expects urlencoded CSRF tokens. Honor `enctype` or document
  the deviation prominently.

---

## 6. Correctness and compatibility findings

| ID | Severity | Finding | Evidence | Recommendation |
| --- | --- | --- | --- | --- |
| COR-01 | 🟠 HIGH | Submitter `formaction`/`formmethod` ignored | `src/boost.ts:305-327`; probe: form `action=/a method=post`, submitter `formaction=/b formmethod=get` → requested `POST /a` | Resolve effective action/method from the submitter first; add tests |
| COR-02 | 🟠 HIGH | `enctype` ignored; always multipart | `src/boost.ts:325-330`; probe: body is `FormData` with no `Content-Type` | Encode per `enctype`; set the correct header for urlencoded/text |
| COR-03 | 🟡 MEDIUM | GET file inputs encode `[object File]` | `new URLSearchParams(FormData)` probe | Use file `name` for GET query entries; browser-test |
| COR-04 | 🟡 MEDIUM | Image submit button coordinates missing | `src/boost.ts:311-313` | Append `name.x`/`name.y` like native |
| COR-05 | 🟡 MEDIUM | No duplicate-submission protection | No in-flight form state | WeakSet of in-flight forms; skip duplicate while pending |
| COR-06 | 🟡 MEDIUM | Head/base/body attributes not synced | `src/dom.ts:28-31`; only `document.title` updated | Document limitation; optional `syncHead`/`syncBodyAttributes` if justified |
| COR-07 | 🟡 MEDIUM | `scrollRestoration` restore is per-instance | `src/boost.ts:106-127`; multiple instances can restore `'manual'` permanently | Reference-count or document single-instance requirement |
| COR-08 | 🟡 MEDIUM | Multiple instances double-handle `popstate` | No event marker for popstate; probe: 2 fetches per back/forward | Mark popstate handled or centralize instance registry |
| COR-09 | 🟡 MEDIUM | `navigate()` returns only `boolean` | `src/types.ts`, `src/boost.ts:131` | Add a typed result/reason (additive API) |
| COR-10 | 🟡 MEDIUM | Invalid selector/config not validated | `resolveOptions` (`src/boost.ts:51-70`) | Validate at start/create; throw clear errors |
| COR-11 | ⚪ LOW | Missing target detected after fetch | `src/boost.ts:197-198` | Resolve target before requesting |
| COR-12 | ⚪ LOW | 204/205 behavior undocumented | `src/boost.ts:177` | Document and test |
| COR-13 | ⚪ LOW | Hash scroll happens before scripts | `src/boost.ts:209-216` | Re-check/retry anchor after scripts if enabled |
| COR-14 | ⚪ LOW | async/defer/module semantics not preserved | `src/dom.ts:37-87` | Respect script attributes or document behavior |
| COR-15 | ⚪ LOW | Hard-coded 5 s script timeout | `src/dom.ts:1, 84` | Make configurable; define ordering semantics |
| COR-16 | ⚪ LOW | Native fallback loses submitter overrides | `HTMLFormElement.prototype.submit.call` | Document; acceptable fallback |
| COR-17 | ⚪ LOW | Full-body replacement destroys state | `innerHTML` swap | Inherent to boost; document |
| COR-18 | ⚪ LOW | Same-URL link re-fetches and pushes a duplicate entry | No same-URL special case | Document or `replace` for identical URL |
| COR-19 | ⚪ LOW | No bfcache/`pageshow` handling | Only `popstate` | Evaluate later |
| COR-20 | ⚪ LOW | Header keys are case-sensitive when merged | `src/boost.ts:157-162` | Normalize or use `Headers` |

### Browser compatibility notes

Required platform features: `fetch`, `AbortController`, `URL`,
`URLSearchParams`, `DOMParser`, `CustomEvent`, `Element.closest`,
`Element.replaceWith`, `ParentNode.querySelectorAll`, `FormData(form)`,
`history.scrollRestoration` (feature-detected), `requestAnimationFrame` (via
NProgress). Output target is ES2020. No polyfills, no legacy bundle, no
documented browser matrix; IE11 and older Edge are not supported.

Additional gaps:

- **Shadow DOM:** `event.target.closest()` does not cross shadow roots; composed
  events are retargeted to the host. Framework-agnostic in light DOM only.
- **Event extensibility:** the `HANDLED` marker uses
  `Object.defineProperty(event, Symbol.for(...))`; modern browsers allow this,
  but a `WeakSet<Event>` avoids mutating native events entirely.
- **Trusted Types:** see SEC-05.
- **IIFE global:** `globalName: 'BoostHtml'` is not documented; only
  `window.boostHtml` is. CDN users cannot call `createBoost()` unless they read
  the bundle.
- **`engines.node >= 18`** describes tooling/SSR, not browser support.

---

## 7. Performance assessment

### 7.1 Measurements (this machine)

Published `dist/` (unminified):

| Artifact | Raw | gzip | brotli |
| --- | ---: | ---: | ---: |
| `dist/index.js` (ESM) | 15,682 B | 4,595 B | 3,917 B |
| `dist/index.cjs` | 17,358 B | 5,176 B | 4,448 B |
| `dist/index.global.js` (IIFE, CDN entry) | 28,629 B | 7,623 B | 6,631 B |

Minified ESM (esbuild, for target comparison):

| Variant | Raw | gzip |
| --- | ---: | ---: |
| Full (with NProgress) | 13,725 B | **5,326 B** |
| Without NProgress | 8,850 B | **3,460 B** |

Minified per-module contribution:

| Module | Bytes in minified output | Share |
| --- | ---: | ---: |
| `src/boost.ts` | 6,319 B | 46.0% |
| `nprogress` | 4,130 B | **30.1%** |
| `src/dom.ts` | 1,275 B | 9.3% |
| `src/progress.ts` | 1,106 B | 8.1% |
| `src/index.ts` | 137 B | 1.0% |

Packaging: 11 files, 45.8 kB tarball, 187.6 kB unpacked; source maps are
106.9 kB of the unpacked size.

### 7.2 Cost model per navigation

1. Event dispatch/delegation — negligible.
2. Eligibility checks — two `closest` calls, one URL parse — negligible.
3. `fetch` + full `response.text()` — network + full-body buffering.
4. `DOMParser.parseFromString` — full HTML parse (main thread).
5. `doc.body.innerHTML` **serialization** back to a string.
6. `target.innerHTML = ...` — **second full parse** and DOM construction.
7. Full subtree teardown/rebuild — style/layout invalidation, image/iframe
   reload, custom element lifecycle, focus loss.
8. Script re-execution (default on) — sequential external loads, up to 5 s per
   script.
9. History/scroll work — negligible.

### 7.3 Findings

| ID | Severity | Finding | Recommendation |
| --- | --- | --- | --- |
| PERF-01 | 🟠 HIGH | Duplicate HTML parse + serialize: DOMParser → body string → `innerHTML` | Move imported nodes with `replaceChildren(document.importNode(doc.body, true))` (or `Range` fragment); benchmark small/medium/large |
| PERF-02 | 🟠 HIGH | NProgress is 30% of minified JS and pushes full min+gzip to 5.33 KB (> 5 KB target); CDN bundle is unminified (7.6 KB gzip) | Remove dependency with an internal optional progress bar (or make it an optional adapter); publish a minified IIFE; add a size gate |
| PERF-03 | 🟡 MEDIUM | External scripts load sequentially and block `navigate()`/`after-swap`, with a 5 s timeout each | Respect `async`/`defer`/`module`, parallelize independent loads, make timeout configurable, or resolve before scripts finish |
| PERF-04 | 🟡 MEDIUM | Full body replacement is O(page) and discards browser state | Inherent to boost; document; optional morph adapter later (not required now) |
| PERF-05 | 🟡 MEDIUM | Unminified CDN artifact; sourcemaps shipped | Minify IIFE (or both), add `*.min.js`, consider excluding maps from the tarball |
| PERF-06 | ⚪ LOW | `CustomEvent` allocations per phase, symbol marking, Set snapshots | Acceptable; revisit only with benchmarks |
| PERF-07 | ⚪ LOW | `rememberScroll` reads `scrollY` and writes state every navigation | Measure; likely negligible |
| PERF-08 | ⚪ LOW | No prefetch/cache (optional features) | Keep disabled by default; roadmap only |
| PERF-09 | 🟠 HIGH (process) | No benchmarks, so the 5 KB/runtime targets cannot be verified or defended | Add a reproducible Playwright + fixture benchmark harness in Phase 0 |

### 7.4 Benchmark plan (proposed)

- Fixtures: small (~20 nodes), medium (~2k nodes, ~200 KB HTML), large
  (~20k nodes, ~2 MB HTML), each with and without scripts.
- Scenarios: click → `after-swap`; back/forward; progress off/on; scripts
  off/on; redirect; hash navigation.
- Metrics: median + p95 wall time from event to `after-swap`, Long Task count,
  JS heap after 100 navigations, network requests, parse counts (instrument
  temporarily), and bundle size (min+gzip).
- Environment: Playwright Chromium/Firefox/WebKit, local HTTP server,
  documented CPU/OS/Node versions.
- Rule: baseline before Phase 1; re-run after every performance-affecting
  phase; never claim an improvement without a reproducible comparison.

---

## 8. Memory and lifecycle assessment

| ID | Risk | Evidence | Assessment / recommendation |
| --- | --- | --- | --- |
| MEM-01 | Duplicate instances leak listeners and double-fetch popstate | `src/index.ts:15-19`; `src/boost.ts:102-104, 333-338`; probe: 2 fetches | High for correctness; mark popstate handled or introduce a singleton/registry |
| MEM-02 | Progress `<style>` persists after `stop()`; `stylesInjected` prevents re-injection after document replacement | `src/progress.ts:18-29` | Low; remove on last stop or make idempotent per document |
| MEM-03 | NProgress global settings/node persist and are shared by instances | `src/progress.ts:40-45` | Low; adapter should own its state |
| MEM-04 | Script-load timers up to 5 s; cleared on load/error/timeout | `src/dom.ts:71-86` | Low; ensure cleanup if `replaceWith` throws |
| MEM-05 | Test-created auto-init instances are never stopped | `tests/auto-init.test.ts` | Test-only leak; stop them or reset modules carefully |
| MEM-06 | `window.boostHtml` keeps the instance alive forever | `src/index.ts:18` | Expected global; document |
| MEM-07 | No unbounded caches, queues, observers, or concurrency | Code review | Positive; preserve when adding optional features |

No evidence of unbounded growth in the core navigation path. The main
lifecycle risk is multiple instances, not the single-instance flow.

---

## 9. Architecture and technical debt

| ID | Severity | Finding |
| --- | --- | --- |
| ARCH-01 | 🟠 HIGH | `BoostController` mixes navigation, form semantics, request, response, history, scroll, events, progress and lifecycle in one ~400-line class. `AGENTS.md` §4 defines separate logical responsibilities. |
| ARCH-02 | 🟡 MEDIUM | Root import auto-starts an instance, while `createBoost()` creates more; there is no coordination, disable switch, `configure()`, or registry. |
| ARCH-03 | 🟡 MEDIUM | An optional subsystem (NProgress) is imported eagerly at module scope, so it costs every consumer even when `progress: false`. |
| ARCH-04 | 🟡 MEDIUM | `ResolvedBoostOptions` and the mutable `Boost.options` object are public; runtime mutation bypasses validation (a probe changed `executeScripts` directly). Prefer readonly public options + validated internal config. |
| ARCH-05 | 🟡 MEDIUM | Boolean-only navigation result hides abort/cancel/HTTP/content-type/origin failures. |
| ARCH-06 | 🟡 MEDIUM | `ProgressOptions` duplicates NProgress' type surface; drift is likely (NProgress options such as `barSelector`, `spinnerSelector`, `positionUsing` are absent). |
| ARCH-07 | 🟡 MEDIUM | Event names are raw strings; no typed event map or `DocumentEventMap` augmentation. |
| ARCH-08 | ⚪ LOW | Silent catches around history/scroll hide failures (`src/boost.ts:344-366`). |
| ARCH-09 | ⚪ LOW | Native events are mutated with a global symbol; a `WeakSet<Event>` is safer. |
| ARCH-10 | ⚪ LOW | Magic constants (5 s, 204/205, header names) are scattered. |
| ARCH-11 | ⚪ LOW | No error taxonomy/reason codes. |
| ARCH-12 | ⚪ LOW | Tests rely on jsdom quirks and module-level state; prototype stubs are not restored. |
| ARCH-13 | ⚪ LOW | No lint/format configuration, so style/consistency is unenforced. |

### Positive architecture findings

- Event delegation, not per-element listeners.
- Latest-wins cancellation with stale checks.
- Clear separation of URL/eligibility rules from DOM helpers (small but real).
- ESM/CJS/IIFE output and declaration mapping are correct; `npm pack` is clean.
- Strict TypeScript, no `any`, no `@ts-ignore`, no unbounded data structures.
- Fallback/native behavior is considered for links and forms.

---

## 10. Missing functionality (all proposed; none implemented)

> Everything in this section is **not present today** unless marked otherwise.
> It is listed to separate “current feature set” from “roadmap”.

### 10.1 Security and policy (proposed)

- Final-URL origin/protocol validation for redirects.
- URL policy for `navigate()` (same-origin + http(s) by default).
- Script execution **off** by default; explicit opt-in policy.
- CSP nonce support for injected `<style>` and re-executed scripts.
- Trusted Types-compatible DOM replacement.
- Optional sanitizer/HTML policy hook (clearly documented as opt-in).
- Response byte limit / streaming guard.
- POST fallback policy that never auto-retries non-idempotent submissions.
- Explicit documentation that `innerHTML`/DOMParser is not sanitization.

### 10.2 Correctness and navigation (proposed)

- Full submitter semantics: `formaction`, `formmethod`, `formenctype`,
  `formtarget`.
- `enctype`-aware encoding (urlencoded, multipart, text/plain).
- Correct GET file-input values (filename).
- Image submit coordinates.
- Duplicate-submission protection.
- Config validation with actionable errors.
- Request timeout option.
- Target resolution before fetch.
- Typed navigation result with failure reasons.
- Multi-instance coordination for `popstate` and `scrollRestoration`.
- Optional head/body-attribute synchronization (disabled by default).
- Shadow DOM policy (document unsupported or support composed paths).
- bfcache/`pageshow` strategy.

### 10.3 Accessibility (proposed)

- Focus management after swap (move focus to main heading/landmark or restore a
  sensible target) without stealing focus.
- `aria-busy` on the target during navigation.
- Optional live-region announcement of navigation completion.
- `lang`/`dir` synchronization when the response changes them.
- Documented keyboard/screen-reader behavior.

### 10.4 Optional performance features (proposed, disabled by default)

- Conservative prefetch (GET, same-origin, eligible links only, hover/visible,
  concurrency-limited, deduplicated, respects Save-Data/connection).
- Bounded in-memory HTML cache with `Cache-Control`/`Vary`/`no-store` handling,
  authenticated-response isolation, and invalidation after mutations.
- Optional morph strategy adapter.
- These must not increase the core path cost when disabled.

### 10.5 Engineering/process (proposed)

- CI (lint, typecheck, coverage, build, size gate, `npm pack` check).
- Playwright browser matrix.
- Benchmark harness and recorded baselines.
- Coverage thresholds and type tests.
- `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`.
- Repository metadata (`repository`, `homepage`, `bugs`, `author`,
  `publishConfig`).
- An actual Git repository and release process.

---

## 11. Comparison with the intended production architecture (`AGENTS.md`)

| Intended requirement | Current state | Verdict |
| --- | --- | --- |
| Core / Navigation / Request / Response / DOM / History / Scroll / Events / Progress boundaries | Mostly one controller + two helpers | Partial |
| Event delegation | Delegated click/submit/popstate | Pass |
| Avoid duplicate HTML parsing | DOMParser + `innerHTML` (double parse) | Fail |
| Default path fast; optional subsystems not initialized | NProgress imported/bundled eagerly | Partial |
| `start()` idempotent, `stop()` releases work | Implemented; multi-instance edge cases | Partial |
| Stale responses cannot commit | Abort + signal checks | Pass |
| No unbounded caches/queues | None exist | Pass |
| Core ≤ 5 KB min+gzip | Core 3.46 KB; full 5.33 KB | Core pass, shipped full fail |
| Same-origin navigation only | Links/forms yes; redirects and `navigate()` no | Fail |
| Validate redirect final URL against origin policy | Missing | Fail |
| Preserve native behavior for ineligible elements | Mostly yes | Pass |
| Abort/cancellation | Implemented | Pass |
| URL/history consistent with displayed content | Cross-origin redirect commit can fail silently | Fail |
| Status/content-type validation | Status yes; missing content-type accepted | Partial |
| Form semantics incl. files, enctype, submitter | GET/POST/submitter name+value only | Partial |
| No automatic retry of non-idempotent submissions | POST fallback re-submits | Fail |
| Duplicate submission prevention | Missing | Fail |
| Scripts not executed by default | Executed by default | Fail |
| No eval/Function | None | Pass |
| Script policy opt-in and documented | Default-on, docs describe but do not warn enough | Fail |
| CSP nonce / Trusted Types considered | Missing | Fail |
| Validate URLs and redirects | Missing | Fail |
| Cache isolation | No cache | N/A |
| No unsafe selectors/DOM clobbering assumptions | Selectors unvalidated; progress id can be clobbered | Partial |
| Security regression tests | Missing | Fail |
| History preservation, scroll restore | Implemented | Pass |
| Focus/accessibility | No focus/aria handling | Fail |
| Restore browser settings on `stop()` | `scrollRestoration` restored per instance | Partial |
| Optional prefetch/cache disabled by default | Not implemented | N/A |
| TypeScript strict, explicit public types, runtime config validation | Strict and typed; validation missing | Partial |
| Unit + integration + real-browser tests | Unit/jsdom only | Fail |
| ESM-first, exports match files, pack verified | Yes | Pass |
| Browser matrix tested/documented | Missing | Fail |
| Zero mandatory runtime dependencies | `nprogress` | Fail |
| Benchmarks with median/p95 | Missing | Fail |
| Lint/format in workflow (if configured) | Not configured | N/A but recommended |

---

## 12. Recommended refactoring strategy

**Principle:** security and correctness first, architecture second, optional
features last. Keep the public API stable except for explicitly approved
security defaults.

### 12.1 Guardrails before refactoring

1. Put the repository under Git (if desired) and add CI.
2. Add lint/format (e.g., ESLint + Prettier or Biome) and coverage.
3. Add Playwright smoke tests for link navigation, back/forward, scroll,
   script policy and CSP.
4. Add a bundle-size gate and a benchmark harness with a recorded baseline.
5. Add `SECURITY.md` and document the threat model.

### 12.2 Target module layout (proposal, not a mandate)

Do **not** create files merely to match this list. Extract when a module gains
real behavior and tests.

```text
src/
  index.ts              # compatibility entry: auto-init + exports
  core.ts               # proposed side-effect-free entry (createBoost/types)
  core/options.ts       # defaults + runtime validation
  core/events.ts        # typed events, dispatch helpers
  navigation/links.ts   # click eligibility
  navigation/forms.ts   # submit eligibility + form semantics
  navigation/navigate.ts# orchestration, cancellation, fallback policy
  request/fetch.ts      # fetch, headers, timeout
  response/document.ts  # status/content-type/origin checks, parsing
  dom/swap.ts           # node adoption/replacement
  dom/scripts.ts        # opt-in script policy
  history/history.ts    # push/replace, popstate, restoration metadata
  scroll/scroll.ts      # scroll/hash/focus
  progress/             # optional progress adapter
  types/public.ts       # stable public types
  types/internal.ts     # internal types
```

Keep `src/boost.ts` as the orchestration facade during extraction to avoid a
big-bang rewrite.

### 12.3 Entry-point strategy (backward compatible)

- Keep `import 'boost-html'` auto-initialising and `window.boostHtml`
  available.
- Add `boost-html/core` (side-effect-free) for tree-shaking and manual control.
- Add `boost-html/auto` as an explicit alias for clarity if desired.
- Update `sideEffects` to the auto entry only; verify with webpack/Rollup/
  Vite before publishing.
- Do not remove the existing root behavior without explicit approval.

### 12.4 Progress strategy

Preferred: replace NProgress with a small internal progress indicator
(~1 KB) that supports the currently documented options (`minimum`, `easing`,
`speed`, `trickle`, `trickleSpeed`, `showSpinner`) and removes the dependency.
Accept an adapter interface for users who want NProgress/other bars.

Alternative: make NProgress an optional peer dependency exposed via a subpath;
the core defaults to a no-op unless an adapter is provided. This preserves the
zero-dep core but changes the default visual behavior and requires a migration
note.

Either way: no eager top-level import of optional code; no mandatory
dependency; document the visual/API differences.

### 12.5 Script policy strategy

- Default `executeScripts: false`.
- Keep `true` as an explicit opt-in with a documented risk warning.
- Add `nonce` for injected assets and re-executed scripts.
- Replace `innerHTML` with node adoption to become Trusted Types-friendly.
- Do not attempt to sanitize HTML with ad-hoc regexes; if sanitization is
  requested, expose an explicit adapter/hook and document that the caller owns
  the policy.
- Add a test proving inline scripts, external scripts, `on*` attributes and
  `javascript:` URLs are handled according to the documented policy.

### 12.6 Multi-instance strategy

- Mark `popstate` with the same handled marker, or maintain a per-document
  instance registry and elect one owner for popstate/scrollRestoration.
- Reference-count `history.scrollRestoration` changes so the original value is
  restored only after the last instance stops.
- Document that multiple instances with different `scope`/`target` are
  unsupported for history ownership until a registry exists.

### 12.7 Error/result strategy

- Introduce a typed failure reason internally:
  `aborted | cancelled | invalid-url | cross-origin | network | http-error |
  not-html | no-target | script-error`.
- Keep `navigate(): Promise<boolean>` for compatibility and add an additive
  detailed result API (or a second return channel/event) rather than breaking
  the boolean contract.
- Ensure only the current navigation can commit, and report why a navigation
  did not commit.

---

## 13. Proposed implementation phases

Each phase is independently releasable and ends with tests + documentation.
Effort: S ≈ <1 day, M ≈ 1–3 days, L ≈ 3–7 days (engineering estimate, not a
commitment).

### Phase 0 — Baseline and guardrails (no runtime behavior change) — M

- Add Git/CI, lint/format, coverage, size-limit, Playwright smoke tests.
- Add benchmark fixtures/harness and record baseline bundle/runtime metrics.
- Add `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` skeleton.
- Document current browser requirements.
- **Exit:** CI green; baseline recorded; `npm pack` verified.

### Phase 1 — Security P0 (surgical) — M/L

- Validate redirect final URL (origin + scheme) before parsing/swapping
  (`SEC-01`).
- Enforce URL policy in `navigate()` and remove `javascript:`/non-http(s) from
  the fallback path (`SEC-02`).
- Default `executeScripts: false`; add nonce option; document no sanitization
  (`SEC-03`, `SEC-04`, `SEC-05` in part).
- Require explicit HTML content type; add configurable response-size guard
  (`SEC-06`, `SEC-07`).
- Decide and implement the POST fallback policy (`SEC-08`).
- Add security regression tests (cross-origin redirect, `javascript:` URL,
  scripts-off, inline-handler policy, content-type).
- **Exit:** all security tests pass; no URL/content mismatch; changelog and
  migration note published.

### Phase 2 — Correctness P1 — M

- Full form semantics (`formaction`, `formmethod`, `formenctype`,
  `formtarget`, `enctype`, file GET, image coordinates) (`COR-01`–`COR-04`).
- Duplicate-submission guard (`COR-05`).
- Runtime config validation and early target resolution (`COR-10`, `COR-11`).
- Request timeout option.
- Multi-instance `popstate` + `scrollRestoration` handling (`COR-07`,
  `COR-08`).
- Typed failure reasons; additive result API (`COR-09`).
- **Exit:** form-semantics and lifecycle tests pass in jsdom + Playwright.

### Phase 3 — Architecture extraction (behavior-preserving) — L

- Extract options/events/request/response/history/scroll/form modules with the
  existing tests as a safety net.
- Add typed event map and readonly public options.
- Add `boost-html/core` side-effect-free entry; keep root auto-init.
- Keep `src/boost.ts` as the facade until the end of the phase.
- **Exit:** public `.d.ts` is additive-only; bundle size not worse; all tests
  green.

### Phase 4 — Zero-dependency progress + bundle optimization — M

- Replace NProgress with an internal optional progress bar or optional adapter.
- Remove `nprogress` from `dependencies`; adjust types/docs.
- Minify the IIFE and publish a `.min.js`; point CDN fields at it.
- Add the size gate (core and full).
- **Exit:** zero runtime dependencies; full min+gzip ≤ 5 KB or a documented,
  measured exception; visual parity documented.

### Phase 5 — Performance: single parse and script policy cost — M

- Replace `innerHTML` swap with node adoption/`replaceChildren` (also improves
  Trusted Types compatibility).
- Optimize script policy (respect async/defer/module, parallelize or don't
  block, configurable timeout).
- Run the benchmark suite and report median/p95 before/after.
- **Exit:** measured improvement on medium/large fixtures with no behavior
  regression.

### Phase 6 — Optional prefetch/cache (only if approved) — L

- Conservative GET prefetch, disabled by default, concurrency-limited and
  deduplicated.
- Bounded cache with `Cache-Control`/`Vary`/`no-store` handling, authenticated
  isolation, invalidation after state-changing requests.
- **Exit:** opt-in only; core path unchanged when disabled; cache behavior
  observable and tested.

### Phase 7 — Accessibility, docs, release — M

- Focus management, `aria-busy`, live announcements, `lang`/`dir` sync.
- Full README/API/security/browser/migration documentation.
- Release checklist, changelog, versioning decision.
- **Exit:** Playwright matrix green; docs complete; release approved
  separately.

---

## 14. Test plan additions (proposed)

| Group | Missing coverage to add |
| --- | --- |
| Security | Cross-origin redirect, protocol change, `javascript:`/`data:` in `navigate()`, scripts-off by default, inline handlers/`javascript:` policy, missing content-type, oversized response, CSP nonce, Trusted Types |
| Lifecycle | Repeated `start()`/`stop()`/restart, listener cleanup, `scrollRestoration` restoration, auto + manual instance, stop with in-flight request, start after stop |
| Forms | `formaction`, `formmethod`, `formenctype`, `formtarget`, `enctype` urlencoded/text, file upload POST, file GET filename, image submit coordinates, duplicate submit, submitter values, native fallback |
| Response/DOM | Missing target, malformed/incomplete document, empty body, 204/205, redirect chains, absent content-type, custom `target`, custom selectors, invalid selectors, before-swap cancellation, after-swap detail |
| History/scroll | Push/replace, back/forward, hash anchors, scroll disabled, history disabled, redirect commit, state merging with primitive/non-object state |
| Accessibility | Focus target/restore, `aria-busy`, announcements, `lang`/`dir` |
| Optional features | Prefetch eligibility/cancellation/concurrency, cache eviction/`Vary`/`no-store`/auth isolation (only when implemented) |
| Packaging/types | `tsd` type tests, built-artifact smoke tests (CJS/IIFE), `npm pack --dry-run`, bundle-size assertions |

Also fix existing test hygiene: restore `Element.prototype.scrollIntoView`,
avoid order dependence on `stylesInjected`, and stop auto-created instances in
tests.

---

## 15. Backward-compatibility risks of the proposed work

| ID | Change | Risk | Mitigation |
| --- | --- | --- | --- |
| BC-01 | `executeScripts` default `true` → `false` | Pages relying on script re-execution stop working | Explicit opt-in, changelog, migration note, possibly major/minor policy |
| BC-02 | Remove NProgress / replace progress | Config shape and visuals change | Keep the documented option subset; adapter; visual parity docs |
| BC-03 | Root import becomes side-effect-free | Breaks `import 'boost-html'` auto-init | Keep root auto; add `core` entry; do not change root |
| BC-04 | Strict `navigate()` URL policy | Cross-origin callers break | Security fix; document; optional explicit cross-origin opt-in |
| BC-05 | Redirect origin rejection | Apps relying on cross-origin redirects break | Document security rationale; fallback full navigation still reaches the destination |
| BC-06 | Multi-instance popstate ownership | Apps intentionally using two instances change behavior | Provide registry/config; document single-owner semantics |
| BC-07 | Enctype-aware forms | Servers expecting multipart may need adjustment | Aligns with native HTML; document; test both encodings |
| BC-08 | Config validation | Invalid configs now throw/fallback earlier | Clear errors; validate at `start()`, not import |
| BC-09 | Public `ResolvedBoostOptions`/mutable `options` | Refactor could remove/mutate them | Keep exports; mark readonly; additive changes only |
| BC-10 | `sideEffects`/entry changes | Bundlers may drop auto-init | Test webpack/Rollup/Vite; keep root listed as side-effectful |
| BC-11 | Event detail additions | Consumers may rely on exact shapes | Additive fields only; never remove/rename |
| BC-12 | Type declaration changes | Consumers with older TS | Keep syntax compatible; add `typesVersions` only if needed |

---

## 16. Decisions required before implementation

1. **Script policy:** approve default `executeScripts: false` (security) and
   its migration story?
2. **NProgress:** internal progress bar (zero-dep, recommended) or optional
   peer/adapter? Which visual/API compatibility is required?
3. **Entry points:** keep root auto-init and add `core`, or introduce a breaking
   side-effect-free root?
4. **Cross-origin policy:** block by default in `navigate()`; provide an opt-in?
5. **POST fallback:** never auto-retry non-idempotent requests, or keep the
   current native fallback with documentation?
6. **Browser baseline:** which browsers/versions must be supported and tested
   (e.g., last two versions of Chrome/Edge/Firefox/Safari)?
7. **Response size limit:** default value and whether it is configurable/opt-out.
8. **Optional features:** is prefetch/cache in scope, or explicitly deferred?
9. **Versioning:** is `0.1.0` published? If not, can security defaults land
   before the first release; if yes, choose patch/minor/major policy.
10. **Repository/CI:** create the Git repository and GitHub Actions workflows?

---

## 17. Audit limitations and non-claims

- This audit did not modify source, tests, build, or configuration.
- No real-browser, network-throttling, memory-profiling, or benchmark results
  were produced. Browser behavior is reasoned from standards and jsdom probes.
- The cross-origin redirect probe used a mocked `fetch`; exploitability in a
  real browser depends on CORS readability of the redirect target.
- No claim is made that listed low-severity items are exhaustive; they are the
  observable issues from static review and targeted probes.
- No release, publish, or version change was performed.

---

## Appendix A — Evidence index (file:line)

| Topic | Location |
| --- | --- |
| Option defaults (scripts on, progress on, scope) | `src/boost.ts:51-70` |
| Auto-init + globals | `src/index.ts:4-24` |
| Click eligibility | `src/boost.ts:262-296` |
| Form handling | `src/boost.ts:298-331` |
| Request headers / fetch | `src/boost.ts:143-173` |
| Status/content-type checks | `src/boost.ts:177-183`, `src/dom.ts:11-14` |
| Redirect URL / hash patch | `src/boost.ts:31-49, 190-191` |
| Body swap (`innerHTML`) | `src/dom.ts:28-31` |
| Script re-execution / dedupe / timeout | `src/dom.ts:17-87` |
| History / scroll restoration | `src/boost.ts:340-385` |
| Fallback navigation | `src/boost.ts:386-399` |
| NProgress import/CSS/start | `src/progress.ts:1, 9-47` |
| Public types | `src/types.ts` |
| Build formats/target | `tsup.config.ts` |
| Package exports/deps/scripts | `package.json` |
| Test inventory | `tests/boost.test.ts`, `tests/auto-init.test.ts` |
| Intended architecture/security rules | `AGENTS.md` §4–§13 |
| Original prototype | `BOOST_HTML.md` |
