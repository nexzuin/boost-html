# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project intends
to follow semantic versioning once it reaches 1.0.

## [Unreleased]

### Security

- Reject redirect responses whose final URL is cross-origin or uses a
  non-http(s) scheme. This prevents swapping external HTML/scripts while the
  address bar still shows the original origin.
- Restrict `navigate()` to same-origin http(s) URLs and stop falling back to
  `location.assign()` for invalid/non-http(s) input.
- Disable script re-execution by default (`executeScripts: false`). It remains
  available as an explicit opt-in.
- Require an explicit HTML content type; missing content types are rejected.
- Add a 2 MiB response-size limit (configurable via `maxResponseBytes`, `0`
  disables it).
- Do not automatically re-submit non-idempotent forms after a failed boosted
  request. `fallbackToNativeForm: true` opts into the previous behavior.
- Add CSP `nonce` support for injected progress styles and re-executed scripts.
- Replace string `innerHTML` body swaps with DOM node adoption, avoiding a
  Trusted Types sink and a second HTML parse.
- Honour form `enctype` (`multipart/form-data`, urlencoded, `text/plain`)
  instead of always sending multipart data.
- Honour submitter `formaction`, `formmethod`, `formenctype` and `formtarget`.
- Use file names for file inputs in GET query encoding and submit image-button
  coordinates.

### Added

- Biome lint/format configuration and scripts.
- V8 coverage thresholds.
- Size-limit bundle gate and minified build output.
- Playwright browser tests (Chromium) and a browser benchmark harness.
- GitHub Actions CI (quality matrix, browser tests, manual benchmark).
- `SECURITY.md`, `CONTRIBUTING.md` and this changelog.
- Documented browser support and the security model.

### Changed

- `executeScripts` now defaults to `false`.
- POST forms without `enctype` now use native `application/x-www-form-urlencoded`
  encoding; add `enctype="multipart/form-data"` for the previous wire format.
- With script execution disabled, `<script>` elements are removed from the
  swapped DOM instead of remaining inert.
- Missing `Content-Type` response headers are no longer treated as HTML.
- Cross-origin `navigate()` calls and cross-origin redirects are rejected.

### Deprecated

- NProgress remains a runtime dependency in this release; replacing it with a
  zero-dependency progress implementation is planned for a later phase.

## [0.1.0]

- Initial implementation: boosted link/form navigation, history and scroll
  restoration, NProgress bar, script re-execution (default on), jsdom tests and
  demo server.
