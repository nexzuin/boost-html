# Production readiness report — v1.0.0 preparation

**Audit date:** 2026-11-04

**Current package version:** `0.1.0` (unchanged)

**Planned release:** `1.0.0`

**Release status:** **BLOCKED — not approved for publication**
**npm publish:** Not executed  
**GitHub Release / tag:** Not created

## Executive summary

The implementation, documentation, package build, local test matrix, and
package archive are prepared for the first stable release candidate. The
working tree is deliberately still version `0.1.0`.

The canonical public repository is now confirmed as
`https://github.com/nexzuin/boost-html`, and the matching `repository`,
`homepage`, and `bugs` fields have been added to `package.json`. The initial
[GitHub Actions run](https://github.com/nexzuin/boost-html/actions/runs/41723917460)
exposed an invalid Node 20 matrix entry: Vitest 5 and the
current build toolchain require newer Node versions. The matrix has therefore
been corrected to Node 22.19.0 and 24.11.0. The corrected [GitHub Actions run](https://github.com/nexzuin/boost-html/actions/runs/41724994801)
completed successfully on Node 22.19.0 / 24.11.0 and all three browsers. It
reported deprecation warnings because checkout/setup-node v4 still targeted
Node 20; action references have now been upgraded to v7 and need one final
remote verification. npm Trusted Publishing still requires account-level
configuration by the maintainer.

## Local validation results

| Area | Result | Evidence |
| --- | --- | --- |
| Biome lint | PASS | `npm run lint` |
| TypeScript | PASS | `npm run typecheck` |
| Vitest | PASS | 149 tests across 9 files |
| Coverage | PASS | 84.47% statements, 80.08% branches, 91.52% functions, 89.96% lines |
| ESM build | PASS | Root/core ESM entries and shared chunks generated |
| CommonJS build | PASS | Root/core CJS entries and shared chunks generated |
| Browser bundles | PASS | Root/core IIFE bundles generated with minification |
| TypeScript declarations | PASS | `.d.ts` and `.d.cts` for root and core entries |
| Bundle size gates | PASS | ESM 8.61 kB ceiling; core IIFE 12.5 kB; browser IIFE 12.6 kB |
| Package exports | PASS | ESM/CJS imports resolve; root/core expose `createBoost()` |
| Package contents | PASS | `npm pack --dry-run --json`: 40 files, 191,926 bytes (713,762 unpacked) |
| Provenance config | PASS | `publishConfig.provenance: true` |
| MIT license | PASS | `license: MIT` and `LICENSE` file |
| Full npm dependency audit | PASS | `npm audit`: 0 vulnerabilities |
| Chromium | PASS | 15 / 15 Playwright tests |
| Firefox | PASS | 14 passed, 1 skipped (Chromium-only Trusted Types test) |
| WebKit | PASS | 14 passed, 1 skipped (Chromium-only Trusted Types test) |
| Combined browser matrix | PASS | 43 passed, 2 skipped, 45 total |
| Repository metadata | PASS | Canonical nexzuin/boost-html URLs configured and metadata verifier passes locally |
| Initial remote GitHub Actions | FAIL (diagnosed) | Node 20 job failed at Vitest; Node 22/24 and all browser jobs passed |
| Corrected remote GitHub Actions | PASS (run 41724994801) | Node 22.19.0 / 24.11.0 and Chromium/Firefox/WebKit passed; initial v4 actions emitted Node 20 deprecation warnings |
| Final remote GitHub Actions | PASS (run 41726351927) | Latest commit passed both Node quality jobs and Chromium/Firefox/WebKit using checkout/setup-node/upload-artifact v7; no Node 20 deprecation warnings |
| Publish workflow | PREPARED / NOT TRIGGERED | `publish.yml` gated on published `v1.0.0`, package version check, and `npm-production` environment |
| npm Trusted Publisher | BLOCKED / PENDING | npm package does not exist yet (registry E404); initial publication/bootstrap required |
| Branch protection | PENDING | `main` was not protected when checked through GitHub API |

### Browser coverage

The real-browser suite covers automatic initialization, link navigation,
back/forward, hash scrolling, POST redirects, multipart file uploads, custom
response targets, script non-execution, transient network failure, superseded
request cancellation, keyboard activation, live-region announcements, and
repeated navigation.

The repeated-navigation test runs in all three engines and checks bounded DOM
state. Chromium additionally uses CDP to collect garbage and enforce a 5 MiB
heap-growth smoke threshold. This is a regression test, not proof that memory
leaks are impossible.

Strict CSP + Trusted Types parsing and progress-style nonce behavior are tested
in Chromium. Firefox and WebKit skip that test because the Trusted Types API is
not available in those engines in this test matrix.

WebKit runs in headed mode under Xvfb on Linux. The GitHub Actions workflow
installs WebKit dependencies and invokes the WebKit project with `xvfb-run`.

## Documentation prepared

- `README.md` rewritten with installation, automatic/manual initialization,
  all options, navigation, forms, lifecycle events, API methods, security,
  browser support, examples, and development commands.
- `docs/API.md` contains the public API, options, event detail types, lifecycle,
  form handling, DOM extension points, prefetch, cache, and Trusted Types.
- `docs/MIGRATION.md` documents the 0.1.x development line to planned 1.0.0.
- `docs/SECURITY.md` records audit findings, severity, mitigations, and risks.
- `CHANGELOG.md` has an Unreleased section; it does not claim 1.0.0 is released.
- `docs/releases/v1.0.0.md` contains draft release notes marked not approved.
- `docs/NPM_PUBLISH_CHECKLIST.md` contains manual release and provenance steps.

## Package and provenance validation

The package whitelist includes the runtime bundles, declarations, README,
license, security policy, API reference, migration guide, and changelog. It
excludes tests, benchmarks, CI files, and release-preparation scripts.

`scripts/verify-package.mjs` checks ESM/CJS export targets, imports the built
ESM/CJS entry points, checks IIFE bundles and declaration files, validates
provenance configuration, and inspects the `npm pack --dry-run --json` file
list. The archive currently contains 40 files, 191,926 bytes compressed, and
713,762 bytes unpacked. Its SHA-512 integrity is
`sha512-GqiUDjRQY62x8pZcyFWmmXw/G/AdtLGvc6uDV2LoqBBTbYyE5LAv0pjmM50LJ6wjDaApIAVHXS6sU7xLzsCX/g==`.

`publishConfig.provenance` is enabled. npm documentation states that GitHub
Actions Trusted Publishing uses OIDC, requires a public repository whose URL
matches `package.json`, a GitHub-hosted runner, `id-token: write`, npm CLI
11.5.1+, and Node 22.14.0+; trusted publishing automatically generates
provenance attestations. Those external account/repository settings are not
configured here. See the official npm documentation:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/generating-provenance-statements/

A gated `.github/workflows/publish.yml` has been prepared but not triggered. It
only reacts to a published GitHub Release tagged exactly `v1.0.0`, verifies the
package version is also `1.0.0`, waits on the `npm-production` environment, and
runs the full release validation before the npm publish step. No release, tag,
secret, or npm publication has been created. The package currently returns
registry E404, so the first-publication bootstrap and subsequent Trusted
Publisher configuration still require maintainer action.

## Remaining blockers

| Priority | Blocker | Required action |
| --- | --- | --- |
| Critical | Canonical public repository URL unknown; no Git remote is configured. | Provide the exact public repository URL. Do not infer or fabricate an owner/name. |
| High | `repository`, `homepage`, and `bugs` metadata are missing. | Set matching URLs after the canonical repository is confirmed; rerun `npm run verify:release-metadata`. |
| High | npm Trusted Publishing is not configured. | Configure the exact GitHub owner, repository, workflow filename, and optional environment in npm package settings after the repository is public. |
| High | GitHub Actions has not run on the canonical remote. | Push the commits and verify all Node and browser matrix jobs on GitHub. |
| Medium | `engines.node` remains `>=18`, while the CI matrix tests Node 20/22/24. | Decide whether to add Node 18 runtime smoke coverage or raise/document the minimum Node version before stable release. |
| Medium | 5 KiB core ESM gzip target remains open. | Continue optimization if 5 KiB is a hard v1.0.0 requirement; current 8.61 kB is only a regression ceiling. |
| Medium | Long-duration memory soak testing has not been performed. | Run representative application soak tests and monitor browser-native memory/RSS. |
| Medium | Trusted Types test runs only in Chromium. | Validate the host application's actual CSP and policy integration in supported browsers. |
| Low | `npm view boost-html version` returns registry E404 at audit time. | Confirm package-name availability in the intended npm account immediately before publication; 404 is not a reservation guarantee. |

`npm run verify:release-metadata` now validates the confirmed GitHub repository
metadata. The package intentionally omits `engines.node`: this is a browser
runtime package, while the development toolchain is tested on Node 22.19.0 and
24.11.0. This avoids imposing an irrelevant Node runtime restriction on browser
consumers.

## Final release restrictions

- `package.json.version` remains `0.1.0`.
- No `npm publish` command was executed.
- No GitHub Release or Git tag was created.
- A guarded publish workflow was added but has not been triggered; it requires a published `v1.0.0` GitHub Release and a protected `npm-production` environment.
- Draft v1.0.0 release notes and checklist do not constitute release approval.

The stable release remains blocked until corrected remote CI passes, npm Trusted
Publishing is configured, remaining quality goals are accepted, and explicit
maintainer approval is given.
