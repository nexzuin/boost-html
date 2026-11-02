# Benchmarks

Browser benchmark for boosted navigation. It serves generated small, medium and
large documents, clicks a boosted link, and measures the time from the click to
the `boost:after-swap` event (including the local HTTP request).

## Run

```bash
npm run bench
# optional:
BENCH_ITERATIONS=50 npm run bench
BENCH_PORT=4174 npm run bench
```

The harness builds the library, starts `benchmarks/server.mjs`, launches
Chromium through Playwright, performs warm-up runs, then reports median, p95,
min and max. It requires `npx playwright install chromium`.

## Baseline

Recorded on 2026-11-02 after the Phase 1 security changes (DOM node adoption
instead of `innerHTML`, scripts off by default):

| Fixture | Nodes | Iterations | Median | p95 |
| --- | ---: | ---: | ---: | ---: |
| small | 20 | 10 | 3.30 ms | 3.80 ms |
| medium | 2,000 | 10 | 10.60 ms | 14.80 ms |
| large | 20,000 | 10 | 77.60 ms | 94.20 ms |

Environment: Linux, Node 24.21.0, Playwright 1.64.1, Chromium 156.0.8078.4,
local server, no network throttling, progress disabled, scripts disabled.

This is a baseline, not a cross-library comparison. Re-run on the same machine
and fixture set when evaluating performance changes; report median and p95.
