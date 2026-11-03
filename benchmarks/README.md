# Performance benchmarks

The production benchmark measures the actual browser build and the actual
`readResponseText` implementation. It separates the main costs so a faster
end-to-end result is not incorrectly attributed to a specific subsystem.

## Run

```bash
npm run bench
# More samples / longer memory run:
BENCH_ITERATIONS=30 MEMORY_ITERATIONS=60 npm run bench
BENCH_PORT=4174 npm run bench
```

The harness builds the package, bundles the response reader for benchmark-only
instrumentation, serves generated fixtures, launches headless Chromium through
Playwright, warms up the browser, and saves a JSON report in
`benchmarks/results/production-baseline.json`. It requires
`npx playwright install chromium`.

### Prefetch-specific benchmark

Run `npm run bench:prefetch` to compare a cold navigation with pointer-down
prefetch under a controlled 120 ms response delay. It records click-to-swap
median/p95, request count, response bytes, and two deliberately unused
speculative requests. Override the workload with `PREFETCH_ITERATIONS` and
`PREFETCH_LATENCY_MS`. Results are saved to
`benchmarks/results/prefetch.json`. This synthetic test isolates the perceived
latency trade-off; it does not predict gains on a particular mobile network.

### Navigation-cache benchmark

Run `npm run bench:cache` to compare cold navigation with an LRU hit for the
same URL. The harness injects 50 ms response latency, measures median/p95
click-to-swap time, verifies server request/byte counts, fills the configured
20-entry cache, then measures V8 heap before fill, after fill, and after
`clearCache()`. Override iterations, entry count and latency with
`CACHE_BENCH_ITERATIONS`, `CACHE_MEMORY_ENTRIES`, and
`CACHE_BENCH_LATENCY_MS`. Results are saved to
`benchmarks/results/cache.json`. CDP heap measurements do not include native
Response body storage or total browser process RSS; see the report limitations.

## Fixture sizes

| Fixture | Generated sections | Parsed elements |
| --- | ---: | ---: |
| Small | 10 | 44 |
| Medium | 100 | 314 |
| Large | 1,000 | 3,014 |

These fit the requested 10–50, 100–500, and 1,000–5,000 element ranges.

## Metrics

- Navigation: click to `boost:after-swap`, including request and processing.
- Request: fetch time, actual bounded streaming response-body read, and combined
  request processing.
- HTML parsing: `DOMParser.parseFromString`.
- Security preflight/filtering: actual `updateDOM` security path with swap
  disabled, so parsing and DOM replacement are not included in this stage.
- DOM replacement: connected-node `replaceChildren`, with fixture fragments
  prepared outside the timed section.
- Event delegation: 10,000 irrelevant click events delivered to the real
  document-level boost listener.
- Memory: V8 heap after explicit CDP garbage collection. The harness performs
  10 warm-up navigations followed by five measured cycles of large-document
  navigations. History uses `replace` to avoid measuring normal history-entry
  growth. This is JS heap, not total browser process/RSS.
- Bundle size: raw and gzip bytes for ESM and IIFE core and browser entry files.

The benchmark uses local HTTP with no network throttling, progress disabled,
and scripts disabled. Results are comparative, not universal browser guarantees.
Run before and after changes on the same machine, browser version, fixture set,
and iteration count. Do not claim an improvement unless the measured median and
p95 support it.

## Bundle budget

The initial goal is core ESM <= 5 KiB minified + gzip. The current ESM
shared runtime chunk is approximately 8.61 KiB gzip, so this goal is **not met**.
The optional prefetch engine is a separate approximately 3.52 KiB gzip ESM
chunk. The navigation cache is another approximately 2.02 KiB gzip ESM chunk;
both are loaded dynamically only when their features are enabled. The browser
IIFE cannot split optional code and includes it in the single bundle
(approximately 12.48 KiB gzip for the core IIFE and 12.53 KiB gzip for the browser IIFE). `npm run size` enforces interim ceilings for
the shared ESM chunk, optional feature chunks, and IIFE bundles; these ceilings
do not redefine or claim success against the 5 KiB goal.

## Results

See [comparison.md](results/comparison.md) for the navigation pipeline before/after
analysis and [prefetch-comparison.md](results/prefetch-comparison.md) for the
prefetch latency/network trade-off and [cache latency/memory results](results/cache-comparison.md).
JSON reports retain raw measurements:
- `results/production-baseline.json`
- `results/production-after.json`
- `results/prefetch.json`
- `results/cache.json`
