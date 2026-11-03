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

The initial goal is core ESM <= 5 KiB minified + gzip. The current measured
core is 7,543 bytes gzip, so this goal is **not met**. `npm run size` currently
enforces interim regression ceilings (7.6 KiB core ESM, 7.7 KiB browser ESM,
7.8 KiB core IIFE, 7.9 KiB browser IIFE). These ceilings keep the measured
bundle from growing while the 5 KiB goal remains open; they do not redefine or
claim success against that goal.

## Results

See [comparison.md](results/comparison.md) for the before/after analysis and
environment. The JSON files retain raw measurements:
- `results/production-baseline.json`
- `results/production-after.json`
