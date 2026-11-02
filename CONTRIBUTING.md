# Contributing

## Setup

Requirements: Node.js 20+ and npm.

```bash
npm ci
npx playwright install chromium
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run lint` | Biome lint/format check |
| `npm run lint:fix` | Apply Biome fixes |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (jsdom) |
| `npm run test:coverage` | Unit tests with coverage thresholds |
| `npm run test:e2e` | Build + Playwright browser tests (Chromium) |
| `npm run build` | ESM, CJS, IIFE, declarations, sourcemaps |
| `npm run size` | Bundle-size gate |
| `npm run bench` | Browser benchmark (small/medium/large fixtures) |
| `npm run demo` | Build + demo server on port 3000 |
| `npm run check` | All non-browser checks used by CI |

## Expectations

- Add or update tests with every behavior change.
- Security-sensitive behavior needs a regression test. See `SECURITY.md`.
- Do not change documented defaults or public API semantics without a migration
  note and versioning decision.
- Keep `start()` idempotent and `stop()` leak-free.
- Do not introduce a runtime dependency without a documented justification.
- Update `README.md` and `CHANGELOG.md` when observable behavior changes.
- Run `npm run check` and, for DOM/history/scroll changes, `npm run test:e2e`
  before opening a pull request.
- Performance changes need a before/after benchmark with environment details.
- Do not reformat unrelated files.

## Public API changes

Additive, documented changes are preferred. Removals, renames, and semantic
changes require explicit approval and a changelog entry. Security fixes that
change defaults must explain the compatibility impact.

## Reporting security issues

Follow `SECURITY.md`; do not use a public issue.
