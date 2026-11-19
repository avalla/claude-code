#!/usr/bin/env python3
"""Summarize measured suite timings, without treating them as model benchmarks."""
import json
import statistics
import sys
from pathlib import Path

for name in sys.argv[1:]:
    report = json.loads(Path(name).read_text())
    values = [row['seconds'] for row in report['runs']]
    print(f"{report['arm']}: n={len(values)}, median={statistics.median(values):.3f}s, range={min(values):.3f}–{max(values):.3f}s; {report['liveStatus']}")
