# Navigation-cache benchmark results

## Environment and workload

- CPU: Intel Core i7-9700 @ 3.00 GHz (8 logical CPUs)
- OS: Linux x64, kernel 7.0.0-34-generic
- Node: v24.21.0
- Playwright: 1.64.1
- Chromium: 156.0.8078.4 (headless)
- Iterations: 12 cold/hit pairs
- Fixture: 1,000-section large HTML document
- Artificial response latency: 50 ms
- Cache configuration: enabled, maxEntries 20, maxAge 30,000 ms
- Response contract: `Cache-Control: public, max-age=30`
- Local loopback HTTP; no network throttling beyond injected latency

## Navigation latency and network use

| Metric | Cold navigation | LRU cache hit |
| --- | ---: | ---: |
| Median click-to-after-swap | 80.5 ms | **29.6 ms** |
| P95 click-to-after-swap | 130.2 ms | **49.2 ms** |
| Requests per navigation pair | 1 | 0 |
| Total server requests | 12 | 12 across 24 navigations |

- Median saved **50.9 ms (63.2%)**.
- P95 saved **81.0 ms (62.2%)**.
- The 24 navigations generated 12 server requests rather than 24.
- Transferred bytes for the 12 cold requests: **1,052,232 B**. Cache hits transferred no additional response body bytes.

## Memory

The benchmark requested 25 unique large pages with a 20-entry LRU limit.

| V8 heap sample | Bytes |
| --- | ---: |
| Before fill (after explicit GC) | 1,401,096 |
| After fill (after explicit GC) | 1,407,036 |
| After `clearCache()` (after explicit GC) | 1,409,012 |

- V8 heap growth after fill: **5,940 B**.
- V8 heap after clear remained **7,916 B above baseline**; this small residual may include unrelated DOM/runtime allocations and is not, by itself, proof of a cache leak.

**Important limitation:** CDP `Runtime.getHeapUsage` measures the V8 JavaScript heap, not browser-native `Response` body storage, network buffers, or total browser process RSS. The small V8 delta must not be interpreted as the total memory cost of retaining 20 HTML responses. The implementation bounds entry count and freshness, but total memory depends on response sizes and browser internals.

## Interpretation

This synthetic test shows substantial latency savings when the same public HTML URL is revisited within its freshness window. It also halves request count in the paired workload. Results depend on server latency, response size, cache headers, and navigation frequency; they are not field telemetry.

The cache is disabled by default. It stores only same-origin HTML GET responses with an explicit `Cache-Control: public` contract, applies the configured maximum age and server freshness limits, and rejects sensitive routes, cookie variance, and non-cacheable directives.

Raw report: [cache.json](./cache.json).
