# Production readiness report — v1.0.0 preparation

**Audit date:** 2026-11-04

**Release package version:** `1.0.0`

**Planned release:** `1.0.0`

**Release status:** Release candidate prepared; publication pending workflow execution
**npm publish:** Pending GitHub Release workflow
**GitHub Release / tag:** Pending

## Executive summary

The implementation, documentation, package build, local test matrix, and
package archive are prepared for the first stable release candidate. The
working tree is deliberately still version `0.1.0`.

The canonical public repository is now confirmed as
`https://github.com/nexzuin/boost-html`, and the matching `repository`,
`homepage`, and `bugs` fields have been added to `package.json`. The initial
[GitHub Actions run](https://github.com/nexzuin/boost-html/actions/runs/41723917460)
exposed an invalid Node 20 matrix entry: Vitest 5 and the
current build toolchain require newer Node versions. The matrix now uses Node 22.19.0 and 24.11.0. GitHub Actions
`checkout`, `setup-node`, and `upload-artifact` have been upgraded to v7,
removing the earlier Node 20 runtime deprecation warnings. The latest verified
full matrix passed both Node quality jobs and Chromium, Firefox, and WebKit
integration jobs. The workflow is green on the canonical GitHub repository.
The maintainer has approved the v1.0.0 release. Publication remains dependent on successful CI and the configured npm-production environment.

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
| Remote GitHub Actions | PASS | Latest verified full matrix passed Node 22.19.0, Node 24.11.0, Chromium, Firefox, and WebKit using Actions v7; no Node 20 deprecation warnings |
| Publish workflow | PREPARED / NOT TRIGGERED | `publish.yml` gated on published `v1.0.0`, package version check, and `npm-production` environment |
| npm Trusted Publisher | BLOCKED / PENDING | Initial npm publication is pending; registry E404 indicates no currently published package but does not guarantee name reservation availability |
| Branch protection | PASS | Active Protect main ruleset; required status checks configured; PR approval count set to 0 by maintainer |

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
- `CHANGELOG.md` contains the dated `1.0.0` stable release entry and retains the `0.1.0` development baseline.
- `docs/releases/v1.0.0.md` contains the approved v1.0.0 release notes.
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

A gated `.github/workflows/publish.yml` is configured to run only after a published GitHub Release tagged exactly `v1.0.0`. It
only reacts to a published GitHub Release tagged exactly `v1.0.0`, verifies the
package version is also `1.0.0`, waits on the `npm-production` environment, and
runs the full release validation before the npm publish step. No release, tag,
secret, or npm publication has been created. The package currently returns
registry E404, so the first-publication bootstrap and subsequent Trusted
Publisher configuration still require maintainer action.

## Remaining blockers

| Priority | Blocker | Required action |
| --- | --- | --- |
| High | GitHub branch protection is enabled. | Verified active `Protect main` ruleset; PR approval count is 0 for the solo-maintainer workflow. |
| High | GitHub `npm-production` environment is configured without required reviewers (single maintainer). | Create the environment and add required reviewers before any release. |
| High | First npm publication and Trusted Publisher setup are pending. | Run the first publication through the guarded workflow using the maintainer-configured NPM_TOKEN; configure npm Trusted Publisher immediately after package creation and remove NPM_TOKEN. |
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

- `package.json.version` is now `1.0.0` on the release branch.
- The latest CI matrix passed on the pre-release commit; the release branch must pass the same checks before merge.
- The `v1.0.0` tag and GitHub Release will be created after the release commit is merged.
- npm publication is delegated to the gated GitHub Actions workflow and must be verified after the GitHub Release is published.

The 5 KiB core ESM gzip goal and long-duration memory soak testing remain known non-blocking limitations documented above.
