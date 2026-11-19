# Local exploratory measurements

Collected 2026-11-14 on macOS arm64 with CLI 2.1.325. Raw measurements are in
`../benchmarks/results-B.json` and `results-C.json`.

| Arm | Runs | Median suite time | Range |
| --- | --- | --- | --- |
| B, baseline 6288350, 14 tests | 3 | 0.898 s | 0.791–1.065 s |
| C, current, 21 tests | 3 | 4.545 s | 3.782–6.667 s |

These are different suites: C includes 200 searches over 1,000/10,000 records.
The timings include npx/process startup; the difference is **not** an estimate
of plugin overhead in a live conversation. Child RSS includes the CLI and test
runner and cannot be attributed to hook memory. Raw units/scope accompany it.

Confirmed correctness: full long-text round trip, bounded search reads and
deterministic reminder/import behavior. Token counts, cost, model continuity,
live latency, disk growth and a matched A/B/C comparison remain unmeasured.
No reduction in tokens or RSS is established. Run the live campaign only after
setting model/access and an explicit budget in `benchmarks/scenarios.json`.
