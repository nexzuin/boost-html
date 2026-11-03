# Changelog

All notable changes to boost-html are documented here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and intends to follow
[Semantic Versioning](https://semver.org/) from the first stable release.

## [1.0.0] - 2026-11-04

First stable release. The `0.1.0` entry below is the initial development baseline.

### Added

- Optional in-memory per-instance LRU navigation cache, disabled by default,
  with configurable entry count and freshness, path exclusions, explicit
  invalidation, and conservative HTTP cache-directive handling.
- Optional same-origin GET prefetch engine with bounded concurrency, request
  deduplication, cancellation, network-condition checks, and response sharing
  with the navigation cache.
- Browser integration coverage for Chromium, Firefox, and WebKit, including
  back/forward, forms, file uploads, network failure, cancellation, repeated
  navigation, and CSP / Trusted Types in Chromium.
- GitHub Actions quality and three-engine browser matrices.
- Package export/content verification and release-readiness documentation.
- Detailed API, security, migration, release-note, and npm publish-checklist
  documentation.

### Changed

- The default DOM update path uses parsed DOM nodes and native replacement;
  morphing remains an application-provided synchronous adapter.
- The built-in progress indicator no longer requires a runtime dependency.
- `formSelector` is applied when deciding whether a form is eligible for
  interception.
- The root entry auto-initializes; `boost-html/core` is the side-effect-free
  manual entry point.
- Bundle size limits include the optional navigation-cache ESM chunk and the
  security hardening overhead.

### Security

- Response scripts are removed and are never automatically executed.
  `executeScripts` is deprecated and ignored; explicit processing requires a
  host-provided `scriptHandler`.
- Reject cross-origin and non-HTTP(S) navigation URLs and final redirect URLs;
  reject URLs containing embedded credentials.
- Filter response embedded browsing contexts, style elements, inline event
  handlers, inline CSS, `srcdoc`, `srcset`, ping, customized built-in `is`, and
  unsafe URL schemes from the selected response subtree.
- Parse custom progress templates with DOMParser and filter active markup
  before insertion; use the host Trusted Types hook under strict enforcement.
- Surface explicit script-handler failures through `boost:error`.
- Cache only explicitly public, fresh same-origin HTML GET responses; reject
  private/no-cache/no-store responses and unsafe/unmatched `Vary` directives.

### Breaking changes intended for the first stable release

- Missing or non-HTML response content types are rejected.
- POST forms without `enctype` use native urlencoded encoding rather than
  multipart encoding.
- Failed non-idempotent forms are not automatically replayed unless
  `fallbackToNativeForm` is explicitly enabled.
- The default navigation response body limit is 2 MiB.
- Cross-origin programmatic navigation and cross-origin redirects are rejected.
- The deprecated `executeScripts` option no longer enables script execution.

## [0.1.0] - Initial development baseline

- Initial implementation of boosted links/forms, Fetch navigation, history and
  scroll restoration, progress UI, response swapping, and the demo server.
- Initial Vitest coverage and development tooling.
