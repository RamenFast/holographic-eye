# Candidate 3 performance receipts

All runs used synthetic data and headless Chromium. Jobs ran serially. No application source changed during measurement.

## Component comparison

`candidate3-perf-long.json` records six alternating baseline/candidate pairs, 5,000 facts, and 120 initial events at 1440×900. Each arm has 20 untimed draws and 40 measured draws per run.

Baseline: v1.2.0 Field, Stream, and field-labels. Candidate: current working modules. Both use current shared UI, state, geometry and CSS. Both force labels off. The v1.2.0 arm needs no legacy adapter.

All ten correctness checks passed, including exact full-canvas pixel hashes and hit IDs/checksum. This is component parity for this vector-only fixture, not whole-release or new-label parity.

| Metric, median across runs | Baseline ms | Candidate ms |
|---|---:|---:|
| Draw median | 5.30 | 5.80 |
| Draw p95 | 6.90 | 7.80 |
| Hit | 0.018 | 0.019 |
| Boot | 194.24 | 204.32 |
| Tail apply | 69.54 | 70.56 |
| Burst apply | 21.75 | 18.08 |

Both arms read viewport geometry once per draw and hit. Candidate draw timing is modestly higher in this run. Do not claim a speedup. Draw timings measure synchronous command submission, not presented-frame latency.

## Separate label layout timing

Raw receipts: `candidate3-label-timing.json` (100 and 20,000 facts), `candidate3-label-timing-1500.json` (1,500 facts). Each contains all 40 warm samples, including visible, accepted and measured counts.

The viewport is 1920×1200, UI scale 1, DPR 1. Facts form a regular grid with unique Unicode content and loaded entities. Zoom is relative to the fitted camera. Cold means first layout after sync with an empty text cache. Sync time is separate. Warm samples retain the text cache while making small camera pans. No warm samples are discarded.

| Facts | Zoom | Visible | Accepted | Measured | Cold ms | Warm p95 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 1 | 100 | 0 | 0 | 0.50 | 0.30 |
| 100 | 2.5 | 32 | 24 | 31 | 19.00 | 0.80 |
| 100 | 8 | 4 | 4 | 4 | 0.50 | 0.40 |
| 1500 | 1 | 1500 | 0 | 0 | 1.70 | 1.20 |
| 1500 | 2.5 | 589 | 24 | 28 | 22.70 | 1.50 |
| 1500 | 8 | 45 | 45 | 45 | 4.40 | 1.30 |
| 20000 | 1 | 20000 | 0 | 0 | 10.10 | 3.20 |
| 20000 | 2.5 | 7952 | 0 | 0 | 7.40 | 1.90 |
| 20000 | 8 | 782 | 48 | 55 | 7.90 | 1.40 |

Counts in the table are from the cold sample. Raw warm samples retain their own counts. Measured means a candidate reached text shaping/cache lookup, not the number of individual measureText calls.

Overview rows scan dots but do not shape text. The 20,000-fact z2.5 row is also an omission-only result. The z8 rows explicitly require accepted and measured labels, so the close-tier results include real text layout. An omitted label is not displaced beside another node.

The first 1200×750 attempt failed its close-tier shaping guard because the 20,000-fact grid stayed too dense. Its stderr is retained in `candidate3-label-timing-attempt1.stderr.log`. No timing-success receipt was produced for that attempt. The larger viewport was a fixture adjustment, not an application change.

Warmed p95 values must be read separately from cold layout values. First text shaping can include font/runtime initialization. These are not repeated process-cold distributions. The 8ms figure is a warmed target, not a universal cold bound. These component timings do not prove whole-Field frame cost or native WebKitGTK performance.
