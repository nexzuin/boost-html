# Prefetch benchmark results

## Environment and workload

- CPU: Intel Core i7-9700 @ 3.00 GHz (8 logical CPUs)
- OS: Linux x64, kernel 7.0.0-34-generic
- Node: v24.21.0
- Playwright: 1.64.1
- Chromium: 156.0.8078.4 (headless)
- Iterations: 10 per scenario
- Artificial response latency: 120 ms
- Pointer-down prefetch lead time before click: 40 ms
- Local loopback HTTP; same 1,000-section large HTML fixture

## Results

| Metric | Cold navigation | Pointer-down prefetch |
| --- | ---: | ---: |
| Click-to-after-swap median | 170.9 ms | 145.1 ms |
| Click-to-after-swap p95 | 192.1 ms | 153.6 ms |
| Requests for clicked route | 10 | 10 |
| Response bytes for clicked route | 875,280 B | 875,280 B |

- Median perceived navigation latency improved by **25.8 ms (15.1%)**.
- p95 latency improved by **38.5 ms (20.0%)**.
- The clicked route used the same number of requests and response bytes. The prefetch request was reused; no second request was made.
- Two deliberately unused pointer-down prefetches generated **2 requests / 10,908 response bytes**. This is the measurable network cost of speculative requests that users do not follow.

## Interpretation

The synthetic workload shows a useful perceived-latency improvement when the user pauses briefly between pointer-down and click. It does not show a reduction in transferred bytes for the clicked destination. Unused prefetches add traffic, which is why prefetch remains disabled by default, concurrency-limited, and constrained by Save-Data / effective connection type.

This is a 10-iteration local benchmark with deterministic injected latency, not field RUM. Actual gains depend on server latency, pointer-to-click timing, cache headers, browser scheduling, network quality, and how often users follow prefetched links. Validate with production telemetry before enabling broadly.

Raw report: [prefetch.json](./prefetch.json).
