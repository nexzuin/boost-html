# Security policy

## Supported versions

boost-html is pre-1.0. Security fixes are applied to the latest published
version. There are no long-term support branches yet.

## Reporting a vulnerability

Please report security issues privately through the repository's Security tab
("Report a vulnerability" / GitHub private security advisory). Do not open a
public issue for an unfixed vulnerability.

Include the affected version or commit, a minimal reproduction, affected
browsers, impact, and any suggested mitigation.

## Security model

boost-html performs boosted navigation for same-origin HTML documents. It is
not an HTML sanitizer and does not turn untrusted HTML into safe HTML.

- Only same-origin http(s) URLs are navigated. Redirects whose final URL leaves
  the origin, or uses another scheme, are rejected.
- Scripts from fetched documents are always removed before insertion.
  executeScripts is deprecated and ignored. Scripts are never automatically
  executed, inline or external.
- An explicitly configured scriptHandler receives detached script nodes.
  Application code that inserts or evaluates those nodes is responsible for
  source validation, CSP, nonce handling and the risks of executing untrusted
  code.
- Inline event-handler attributes (on*), srcdoc, and javascript:/vbscript: URL
  attributes on response descendants are removed as defense in depth. This is
  limited active-content filtering, not a general sanitizer.
- createHTML may supply a host-owned Trusted Types policy result to DOMParser.
  boost-html does not create a permissive policy and does not sanitize HTML.
- The default head mode updates document.title only. head: 'metadata' copies
  only allowlisted descriptive meta fields; it never copies CSP, http-equiv,
  charset, base, stylesheets, links or scripts.
- Responses must declare text/html or application/xhtml+xml. Other or missing
  content types are rejected.
- Response bodies are limited to 2 MiB by default (maxResponseBytes); 0 disables
  the limit.
- Non-idempotent form submissions are never retried automatically after a
  failure. fallbackToNativeForm: true opts into native re-submission and can
  duplicate server-side effects.
- nonce applies to injected progress styles and is passed to explicit script
  handlers in the DOM update context.

## Server-side responsibilities

- Authenticate and authorize every request; boosted requests are ordinary
  same-origin requests with extra HX-* headers.
- Validate Origin/CSRF tokens as appropriate.
- Return a complete text/html document, not a partial fragment.
- Do not expose open redirects. The library rejects cross-origin redirect
  destinations, but the application should also prevent them.
- Treat user-generated HTML as untrusted and sanitize it server-side or with an
  application-owned sanitizer before returning it.

## Known non-goals

- Sanitizing arbitrary HTML.
- Protecting against a compromised same-origin server.
- Replacing server-side CSRF, authorization, or output-encoding controls.
