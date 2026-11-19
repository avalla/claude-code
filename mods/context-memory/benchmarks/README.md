# Reproducible measurements

Run from the repository root:

```sh
python3 mods/context-memory/benchmarks/run-local.py --output /tmp/context-memory-C.json
python3 mods/context-memory/benchmarks/summarize.py /tmp/context-memory-C.json
```

For baseline B, extract commit 6288350 into a temporary checkout and pass its
absolute path with `--root` and `--arm B`. Do not reset the working repository.
The runner measures actual dispatcher tests, process startup and child RSS;
it does not measure model token savings or compare equivalent workload latency.

`scenarios.json` fixes the intended live scenarios and arm definitions. Live runs
remain pending until a model, access and explicit spending ceiling are set.
Use fresh sessions/config directories and alternate A/B/C for three replicas.
For compaction seed ten numbered facts and score exact retention separately
from instruction compliance; for long output require the tail marker after
character 32768. Record actual usage/cache/cost and total latency, with null
and a reason for missing fields. Never infer RSS from tokens or sum usage
already included in the session ledger twice. See IMPLEMENTATION-PLAN.md.
