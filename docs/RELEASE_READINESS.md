# Production release readiness report

**Audit date:** 2026-11-03  
**Package version:** `0.1.0` (unchanged)  
**Release status:** **Not ready to publish yet**  
**npm publish:** Not executed  
**GitHub Release:** Not created

## Executive summary

The repository now has a reproducible local quality pipeline, a three-engine
Playwright project matrix, package export/content verification, and a GitHub
Actions workflow for Node and browser matrices. The local validation completed
successfully on this workstation for Chromium, Firefox, and WebKit.

This report does not certify production readiness or authorize a release. The
GitHub Actions workflow has been committed but has not yet run on GitHub. The
package is still version `0.1.0`, and repository metadata is incomplete because
no Git remote or `package.json.repository` URL is configured in this checkout.
That metadata must be supplied and verified before a stable release.

## Local validation results

| Area | Result | Evidence |
| --- | --- | --- |
| Lint | PASS | `npm run lint` via `npm run check` |
| TypeScript | PASS | `npm run typecheck` |
| Vitest unit / component suite | PASS | 148 tests across 9 files |
| Coverage | PASS | 84.39% statements, 79.96% branches, 91.52% functions, 89.96% lines |
| ESM build | PASS | `dist/index.js`, `dist/core.js` and shared chunks |
| CJS build | PASS | `dist/index.cjs`, `dist/core.cjs` and shared chunks |
| Browser bundles | PASS | `dist/index.global.js`, `dist/core.global.js` |
| TypeScript declarations | PASS | `.d.ts` and `.d.cts` for root and core entries |
| Bundle size gates | PASS | all configured size-limit budgets passed |
| Package exports | PASS | ESM and CJS imports verified; root/core expose `createBoost()` |
| Package contents | PASS | `npm pack --dry-run --json`: 39 files, 191,330 bytes |
| Chromium | PASS | 15 / 15 Playwright tests |
| Firefox | PASS | 14 passed, 1 skipped (Chromium-only Trusted Types test) |
| WebKit | PASS | 14 passed, 1 skipped (Chromium-only Trusted Types test) |
| Combined browser matrix | PASS | 43 passed, 2 skipped, 45 total |
| `npm audit --omit=dev` | PASS | 0 production dependency vulnerabilities reported |
| GitHub Actions | Pending | Workflow committed; no remote CI run available yet |

### Browser coverage

The browser suite exercises:

- automatic initialization and boosted link navigation;
- browser back/forward, hash navigation, and scroll restoration;
- boosted POST forms, redirects, multipart uploads, and file inputs;
- native fallback after HTTP 500 and transient network failure;
- superseded in-flight navigation cancellation;
- no execution of scripts in fetched response HTML;
- strict CSP + Trusted Types parsing and progress-style nonce behavior in
  Chromium, where the Trusted Types API is available;
- 24 repeated navigations with bounded DOM state in all three engines, plus a
  Chromium CDP heap-growth smoke threshold of 5 MiB.

The two skips are intentional: the strict Trusted Types test is Chromium-only.
The repeated-navigation test runs in all three engines; only Chromium exposes
the CDP heap metric used by the additional heap assertion. This is a regression
smoke test, not proof that no memory leak exists.

WebKit uses its GTK build in headed mode under Xvfb on Linux. The GitHub Actions
job installs Playwright's WebKit system dependencies and runs it through
`xvfb-run`.

## Build and package checks

The current build emits:

- ESM runtime entry points and shared chunks;
- CommonJS runtime entry points and shared chunks;
- browser IIFE bundles for root and core;
- `.d.ts` and `.d.cts` declaration files.

`npm run verify:package` validates the declared export targets, imports the ESM
and CJS entry points, checks the declarations and browser global bundles, then
runs `npm pack --dry-run --json` and checks the resulting package file list.
Development-only `tests/`, `e2e/`, `benchmarks/`, `.github/`, and `scripts/`
files are rejected from the package archive.

The package archive currently contains 39 files and is 191,478 bytes. The
version remains `0.1.0`; this phase did not change the version.

## CI pipeline added

`.github/workflows/ci.yml` now defines:

1. A quality matrix on Node 20, 22 and 24: install, production dependency
   audit, lint, typecheck, Vitest with coverage, build, bundle-size gates,
   package verification, and `npm pack --dry-run`.
2. A browser integration matrix on Chromium, Firefox and WebKit, including
   browser installation and test artifact upload on failures.
3. A manual-only Chromium benchmark job.

The workflow has not been executed by GitHub in this task. A successful local
run cannot establish that hosted runners, remote caches, action permissions,
or branch protection settings are configured correctly.

## Remaining release blockers

| Priority | Blocker | Required action |
| --- | --- | --- |
| High | `package.json.repository.url` is missing and `git remote -v` returns no remote. | Supply the canonical public repository URL; do not guess an owner or repository. Add and validate `repository`, `bugs`, and `homepage` metadata in the release-preparation phase. |
| High | GitHub Actions has not run on the remote repository. | Push the CI commit and verify all Node and browser matrix jobs on GitHub. Resolve any runner-specific failures. |
| Medium | Node 18 is declared in the package engine range but is not in the current CI matrix. | Confirm the minimum supported runtime; either add Node 18 coverage where the dev toolchain permits it or raise/document the engine floor in the release-preparation phase. |
| Medium | Strict CSP / Trusted Types is verified only in Chromium. | Keep the documented browser support boundary; test actual application CSP headers and policy integration in supported deployment browsers. |
| Medium | Heap regression coverage is a threshold smoke test, not a leak proof. | Run longer soak tests against representative applications and monitor browser-native memory / RSS where practical. |
| Medium | Security depends on server HTML trust, CSRF controls, and cache-public correctness. | Complete application-level security review using [`SECURITY.md`](./SECURITY.md) before deployment. |
| Low | Release documentation and changelog still need stable-release curation. | Complete the v1.0.0 documentation and release checklist only after the blockers above are reviewed. |

## Commands

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run size
npm run verify:package
npm run test:integration
npm pack --dry-run
```

## Release restrictions honored

- `npm publish` was not executed.
- No GitHub Release or tag was created.
- `package.json.version` was not changed to `1.0.0`.
- No automatic release action is configured in the CI workflow.

A stable release still requires explicit release approval after the remaining
blockers have been resolved.
