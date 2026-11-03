# npm publish checklist — boost-html v1.0.0

<badge>Preparation only — publishing is disabled</badge>

This checklist is a manual release procedure. It does not create a GitHub
Release, tag, or npm publication. Do not execute it until all blockers are
resolved and the maintainer explicitly approves the release.

## 1. Repository and package identity

- [x] Canonical public repository URL confirmed: `https://github.com/nexzuin/boost-html`.
- [x] Matching `repository`, `homepage`, and `bugs` metadata added to `package.json`.
- [x] Prepare `.github/workflows/publish.yml`; it only runs for a published
      GitHub Release tagged `v1.0.0`, checks the package version, and requires
      the `npm-production` GitHub environment.
- [ ] Configure the `npm-production` GitHub environment with required reviewers
      before creating any release.
- [ ] After the package exists on npm, configure its Trusted Publisher as:
      GitHub Actions / user `nexzuin` / repository `boost-html` / workflow
      filename `publish.yml` / environment `npm-production`.
- [ ] Allow `npm publish` for that Trusted Publisher. npm requires the workflow
      filename only, not `.github/workflows/`.
- [ ] Confirm the `boost-html` package name is publishable under the intended
      npm account; the current public registry lookup returns E404, but that is
      not a guarantee that the name is reserved-free.
- [ ] Confirm package description, keywords, MIT license, `LICENSE`, README,
      changelog, migration guide, and security policy.
- [ ] Confirm maintainership and npm account ownership / 2FA requirements.

## 2. Release source and CI

- [x] Repository is synchronized with `https://github.com/nexzuin/boost-html`; latest CI commit is pushed. Re-check the final release commit before publication.
- [x] Latest GitHub Actions run [41725977643](https://github.com/nexzuin/boost-html/actions/runs/41725977643)
      passed on Node 22.19.0 / 24.11.0 and Chromium, Firefox, and WebKit using
      Node 24-based GitHub Actions v7. Re-run this gate against the final release
      commit before publication.
- [ ] Review all test artifacts and any retries; do not accept a flaky-only
      green result without investigation.
- [ ] Enable a `main` branch ruleset requiring pull requests and these status
      checks: Quality (Node 22.19.0), Quality (Node 24.11.0), Browser
      integration (chromium), Browser integration (firefox), and Browser
      integration (webkit). The branch was unprotected at the last API check.
- [ ] Review `docs/SECURITY.md` and resolve any application-level deployment
      concerns.

## 3. Package validation

Run from a clean checkout at the exact release commit:

```bash
npm ci
npm audit
npm run check
npm run test:integration
npm pack --dry-run --json
```

- [ ] Verify ESM and CommonJS root/core exports.
- [ ] Verify browser IIFE bundles and global names.
- [ ] Verify `.d.ts` and `.d.cts` declarations.
- [ ] Inspect the complete `npm pack --dry-run --json` file list.
- [ ] Confirm no tests, benchmarks, CI files, local secrets, or temporary
      artifacts are included.
- [ ] Record the exact tarball file count, unpacked size, and SHA-512 integrity.
- [ ] Confirm `package.json` version is the approved `1.0.0` only after approval.

## 4. npm provenance / trusted publishing

The prepared `.github/workflows/publish.yml` uses a GitHub-hosted runner, Node
24.11.0, npm CLI 11.15.0, `id-token: write`, and
`npm publish --provenance --access public`. It is guarded by both the exact
`v1.0.0` release tag and package version `1.0.0`, and it waits at the
`npm-production` GitHub environment. It has not been triggered.

**First-publication bootstrap:** the registry currently returns E404 for
`boost-html`, so no npm package settings page or existing Trusted Publisher can
be verified. The npm `npm trust` CLI also requires the package to exist first.
For the first package creation only, a maintainer may add a narrowly scoped
npm Granular Access Token as the GitHub repository secret `NPM_TOKEN`; the
workflow passes it only to the publish step and still requests provenance from
the public GitHub-hosted build. The npm `npm trust` CLI requires the package to
exist first, so the first publication cannot be configured through that CLI.
After the first successful publication, create the Trusted Publisher using the
exact values above, verify it with a subsequent approved release, and remove
`NPM_TOKEN`. Do not create or add this secret until the first release is
explicitly approved.

npm Trusted Publishing requires npm CLI 11.5.1 or later, Node 22.14.0 or later,
a public matching repository, a GitHub-hosted runner, and `id-token: write`.
When the Trusted Publisher is active, npm automatically generates provenance
and OIDC authentication is preferred over long-lived tokens.

References:

- https://docs.npmjs.com/generating-provenance-statements/
- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/cli/using-npm/config/#provenance
- https://docs.npmjs.com/viewing-package-provenance/

## 5. Actual release — explicit approval required

- [ ] Maintainer approves version `1.0.0` and release notes.
- [ ] Update `package.json` and lockfile version to `1.0.0`.
- [ ] Move the approved changes into a dated `CHANGELOG.md` release section.
- [ ] Create and push the annotated `v1.0.0` tag.
- [ ] Create the GitHub Release only after the tag and CI status are verified.
- [ ] Use the configured trusted-publishing workflow to publish to npm with
      provenance.
- [ ] Verify the published version, tarball contents, and provenance
      attestation in npm's package page; run `npm audit signatures` in a clean
      consumer project to verify registry signatures and attestations.
- [ ] Test installation from the public npm registry in a clean project.

## Current blockers

- The corrected GitHub Actions matrix must pass after the latest commit is pushed.
- The `npm-production` GitHub environment needs required reviewers.
- The package does not exist on npm yet (registry E404); first-publication bootstrap and Trusted Publisher configuration remain pending.
- The `main` branch is not protected by a required-check ruleset.
- The package version is still `0.1.0` by design.

Do not bypass these blockers or publish from a local workstation.
