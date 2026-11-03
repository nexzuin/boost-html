# npm publish checklist — boost-html v1.0.0

<badge>Preparation only — publishing is disabled</badge>

This checklist is a manual release procedure. It does not create a GitHub
Release, tag, or npm publication. Do not execute it until all blockers are
resolved and the maintainer explicitly approves the release.

## 1. Repository and package identity

- [ ] Supply the canonical public GitHub repository URL.
- [ ] Add matching `repository`, `homepage`, and `bugs` metadata to
      `package.json`.
- [ ] Verify the repository is public and the npm trusted-publisher
      configuration uses the exact case-sensitive repository owner/name and
      workflow filename (npm asks for the filename, not the full path).
- [ ] In npm Trusted Publisher settings, explicitly allow `npm publish` (or
      choose staged publishing only if that approval flow is intentionally
      adopted).
- [ ] Confirm the `boost-html` package name is publishable under the intended
      npm account; an npm registry 404 is not a guarantee that a name is
      reserved-free.
- [ ] Confirm package description, keywords, MIT license, `LICENSE`, README,
      changelog, migration guide, and security policy.
- [ ] Confirm maintainership and npm account ownership / 2FA requirements.

## 2. Release source and CI

- [ ] Push the approved source commit to the canonical repository.
- [ ] Confirm the GitHub Actions Node 20/22/24 quality matrix passes.
- [ ] Confirm Chromium, Firefox, and WebKit browser jobs pass on GitHub-hosted
      runners.
- [ ] Review all test artifacts and any retries; do not accept a flaky-only
      green result without investigation.
- [ ] Confirm branch protection requires the quality and browser checks.
- [ ] Review `docs/SECURITY.md` and resolve any application-level deployment
      concerns.

## 3. Package validation

Run from a clean checkout at the exact release commit:

```bash
npm ci
npm run check
npm run test:integration
npm audit
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

Preferred method: configure npm Trusted Publishing for the canonical public
GitHub repository and the exact release workflow. The workflow must run on a
GitHub-hosted runner, use npm CLI 11.5.1 or later with Node 22.14.0 or later,
and grant `id-token: write`. npm automatically generates provenance
attestations for supported GitHub Actions trusted-publishing flows; no
long-lived npm publish token is required for the publish step.

If trusted publishing cannot be used, publish from a supported cloud CI/CD
runner with provenance enabled (`npm publish --provenance`). For the first
public publication, npm's provenance guidance recommends explicitly passing
`--access public`; use `npm publish --provenance --access public`. The package
declares `publishConfig.provenance: true` as preparation, but the repository
URL and trusted publisher must still be configured and verified.

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

- `package.json.repository`, `homepage`, and `bugs` metadata are not configured
  because this checkout has no Git remote and the canonical URL is unknown.
- The GitHub Actions workflow has not yet run on the canonical remote repository.
- npm Trusted Publishing has not been configured in npm account settings.
- The package version is still `0.1.0` by design.

Do not bypass these blockers or publish from a local workstation.
