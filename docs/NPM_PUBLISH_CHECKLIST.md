# npm publish checklist — boost-html v1.0.0

<badge>Approved release — publication pending</badge>

This checklist records the approved v1.0.0 release process. The guarded GitHub Actions workflow performs npm publication only after the GitHub Release is published.

## 1. Repository and package identity

- [x] Canonical public repository URL confirmed: `https://github.com/nexzuin/boost-html`.
- [x] Matching `repository`, `homepage`, and `bugs` metadata added to `package.json`.
- [x] Prepare `.github/workflows/publish.yml`; it only runs for a published
      GitHub Release tagged `v1.0.0`, checks the package version, and requires
      the `npm-production` GitHub environment.
- [x] Configure the `npm-production` GitHub environment; the solo maintainer has disabled required reviewers.
- [ ] After the package exists on npm, configure its Trusted Publisher as:
      GitHub Actions / user `nexzuin` / repository `boost-html` / workflow
      filename `publish.yml` / environment `npm-production`.
- [ ] Allow `npm publish` for that Trusted Publisher. npm requires the workflow
      filename only, not `.github/workflows/`.
- [x] Confirm no existing public package is returned by registry lookup (E404); npm will make the definitive name availability check during initial publication.
- [ ] Confirm package description, keywords, MIT license, `LICENSE`, README,
      changelog, migration guide, and security policy.
- [ ] Confirm maintainership and npm account ownership / 2FA requirements.

## 2. Release source and CI

- [x] Repository is synchronized with `https://github.com/nexzuin/boost-html`; latest CI commit is pushed. Re-check the final release commit before publication.
- [x] Latest GitHub Actions run [41726351927](https://github.com/nexzuin/boost-html/actions/runs/41726351927)
      passed on Node 22.19.0 / 24.11.0 and Chromium, Firefox, and WebKit using
      Node 24-based GitHub Actions v7. Re-run this gate against the final release
      commit before publication.
- [ ] Review all test artifacts and any retries; do not accept a flaky-only
      green result without investigation.
- [x] Enable the `Protect main` ruleset requiring PRs and all five CI status checks; approval count is 0 for the solo maintainer.
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
- [x] Set `package.json` and lockfile version to the approved `1.0.0`.

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
npm Granular Access Token as the `NPM_TOKEN` secret in the GitHub
`npm-production` environment; the workflow passes it only to the publish step
and still requests provenance from the public GitHub-hosted build. The npm `npm trust` CLI requires the package to
exist first, so the first publication cannot be configured through that CLI.
After the first successful publication, create the Trusted Publisher using the
exact values above, verify it with a subsequent approved release, then remove
`NPM_TOKEN` after OIDC publication succeeds.

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

- [x] Maintainer approved version `1.0.0` and release process.
- [x] Update `package.json` and lockfile version to `1.0.0`.
- [x] Move the approved changes into a dated `CHANGELOG.md` release section.
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
- The `npm-production` GitHub environment is configured for the solo maintainer.
- The package does not exist on npm yet (registry E404); first-publication bootstrap and Trusted Publisher configuration remain pending.
- The `main` branch is protected by the active `Protect main` ruleset.
- The release branch package version is `1.0.0`.

Do not bypass these blockers or publish from a local workstation.
