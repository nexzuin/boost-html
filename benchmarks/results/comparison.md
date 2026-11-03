# Production performance comparison

Both reports were captured on the same Linux host and browser build, with 25
navigation samples per fixture and five memory cycles of 40 large-document
navigations each. Reports:

- Before: `production-baseline.json`
- After: `production-after.json`

## Environment

- Intel Core i7-9700 @ 3.00 GHz, 8 logical CPUs
- Linux x64, kernel 7.0.0-34-generic
- Node 24.21.0
- Playwright 1.64.1
- Chromium 156.0.8078.4 (headless)
- Local HTTP server, no network throttling
- Progress indicator and response scripts disabled
- 25 iterations for stage/navigation timings; 200 measured large navigations for heap sampling after 10 warm-ups

## Before / after

All timings are median milliseconds unless otherwise noted.

| Metric | Small before → after | Medium before → after | Large before → after |
| --- | ---: | ---: | ---: |
| Navigation click → after-swap | 4.0 → 3.9 | 6.4 → 6.9 | 26.4 → 25.7 |
| Request fetch + body read | 1.4 → 1.4 | 1.5 → 1.6 | 2.7 → 2.5 |
| DOMParser | 0.1 → 0.1 | 0.3 → 0.3 | 1.6 → 2.0 |
| Security preflight/filter | 0.0 → 0.0 | 0.1 → 0.0 | 0.4 → 0.3 |
| Native DOM replacement | 0.0 → 0.0 | 0.1 → 0.1 | 0.5 → 0.6 |

Large navigation median changed from 26.4 ms to 25.7 ms, while p95 moved
from 31.9 ms to 37.4 ms. Medium navigation median moved from 6.4 ms to 6.9 ms.
These mixed results do not establish an end-to-end speedup; p95 is sensitive to
host scheduling and the overall path is effectively unchanged within benchmark
noise. The targeted security preflight stage for a normal large response fell
from 0.4 ms to 0.3 ms median (p95 remained 0.5 ms). This is a measured but
narrow improvement, not a claim that navigation is faster overall.

Request body reading changed from 0.7 ms to 0.6 ms median for the large fixture;
the combined request processing median changed from 2.7 ms to 2.5 ms. This
difference is small and not enough to claim a reliable wall-clock win. The
streaming decoder does remove the intermediate full-size contiguous byte
buffer and avoids the old chunks → copied Uint8Array → decoded string path.

Event delegation was 1.41 µs/event before and 1.45 µs/event after. No event
handler algorithm change was retained because the measurement does not justify
one. DOMParser and native replacement were also left native: their measured
costs are already low and there was no evidence that custom parsing or morphing
would help.

## Memory

After 200 large-document navigations, with history entries replaced and forced
V8 garbage collection between samples:

- Before: +14,236 bytes retained heap from the warmed-up starting sample.
- After: +16,888 bytes.

The per-cycle deltas flatten after the first cycle and the final after sample
decreased slightly. This does not show a steadily growing retained heap or an
obvious leak in this workload. The difference between runs is small and is not
evidence of a memory improvement. This measures V8 JS heap only, not browser
process RSS, GPU memory, or native DOM allocations.

## Bundle size and dependencies

| Bundle | Before gzip | After gzip | Delta |
| --- | ---: | ---: | ---: |
| Core ESM | 7,478 B | 7,549 B | +71 B |
| Browser ESM | 7,542 B | 7,607 B | +65 B |
| Core IIFE | 7,668 B | 7,734 B | +66 B |
| Browser IIFE | 7,733 B | 7,800 B | +67 B |

The initial core ESM goal of 5 KiB gzip is **not met**: the current core is
7,549 bytes gzip (about 47% over the 5,120-byte target). The code changes add
a small bundle-size regression; the new size-limit ceilings are interim
regression guards, not a redefinition of the 5 KiB goal.

The package still has zero mandatory runtime dependencies
(`dependencies: {}`).

## Conclusion

The evidence supports a narrower sanitizer preflight fast path and a response
reader that avoids an intermediate full-size byte copy. It does not support a
claim of a material overall navigation speedup. Event delegation, HTML parsing,
and native DOM replacement were deliberately not rewritten: no measured
benefit justified adding complexity or dependencies.
