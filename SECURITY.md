# Security policy

## Supported versions

`boost-html` is pre-1.0. Security fixes are applied to the latest published
version. There are no long-term support branches yet.

## Reporting a vulnerability

Please report security issues privately through the repository's **Security**
tab ("Report a vulnerability" / GitHub private security advisory). Do not open a
public issue for an unfixed vulnerability.

Include:

- the affected version or commit;
- a minimal reproduction (HTML, server response, configuration);
- the browser(s) affected;
- the impact you believe is possible;
- any suggested fix or mitigation.

You will receive an acknowledgement when the report is triaged. Please allow time
for a fix before public disclosure.

## Security model

`boost-html` performs boosted navigation for **same-origin HTML documents**. It is
not an HTML sanitizer and does not turn untrusted HTML into safe HTML.

- Fetched HTML is treated as trusted only as much as a normal full-page load of
  the same URL.
- Only same-origin `http(s)` URLs are navigated. Redirects whose final URL leaves
  the origin, or uses another scheme, are rejected and the browser performs a
  normal navigation instead.
- Scripts from fetched documents are **not executed by default**.
  `executeScripts: true` is an explicit opt-in and re-executes inline, external,
  `async`, `defer` and module scripts from the response.
- Disabling script execution is **not sanitization**: inline event-handler
  attributes (for example `onerror`) and `javascript:` URLs present in fetched
  markup remain active, just as they do on a full page load.
- Responses must declare an HTML content type (`text/html` or
  `application/xhtml+xml`). Other or missing types are rejected.
- Response bodies are limited to 2 MiB by default (`maxResponseBytes`); `0`
  disables the limit.
- Non-idempotent form submissions are never retried automatically after a
  failure. `fallbackToNativeForm: true` opts into re-submitting natively and can
  duplicate server-side effects.
- `nonce` applies a CSP nonce to injected progress styles and re-executed
  scripts that do not already have one.
- Body replacement uses DOM node adoption rather than string `innerHTML`, which
  avoids a Trusted Types sink for the swap itself. Injected progress styles still
  require a CSP that permits them (or a nonce).

## Server-side responsibilities

- Authenticate and authorize every request; boosted requests are ordinary
  same-origin requests with extra `HX-*` headers.
- Validate `Origin`/CSRF tokens as appropriate. Form `enctype` is preserved, so
  urlencoded and multipart requests are sent as the browser would send them.
- Return `text/html` with the full document, not a partial fragment.
- Do not expose open redirects. The library rejects cross-origin redirect
  destinations, but the application should also prevent them.
- Treat user-generated HTML as untrusted and sanitize it server-side or with an
  application-owned sanitizer before returning it.

## Known non-goals

- Sanitizing arbitrary HTML.
- Protecting against a compromised same-origin server.
- Replacing server-side CSRF, authorization, or output-encoding controls.
