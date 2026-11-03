# Security policy

boost-html is pre-1.0. Security fixes are applied to the latest maintained
revision; no long-term support branches are currently provided.

## Reporting a vulnerability

Please report security issues privately through the repository GitHub Security
tab / private vulnerability reporting. Do not open a public issue for an
unfixed vulnerability. Include the affected version or commit, a minimal
reproduction, affected browsers, impact, and any suggested mitigation.

## Security model

The detailed browser-side security audit, threat boundaries, findings,
mitigations, residual risks, and regression coverage are documented in
[`docs/SECURITY.md`](./docs/SECURITY.md).

boost-html is not a general-purpose HTML sanitizer. Applications remain
responsible for server-side authorization, CSRF protection, output encoding,
Trusted Types policy design, and the safety of any explicitly configured
script handler. Do not mark user-specific HTML as `Cache-Control: public`.
