#!/usr/bin/env python3
"""Measure the real deterministic hook suite; never initiates model requests."""
import argparse
import json
import os
import platform
import resource
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[3])
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--arm', choices=['B', 'C'], default='C')
parser.add_argument('--replicas', type=int, default=3)
args = parser.parse_args()
if args.replicas < 1:
    parser.error('replicas must be positive')
command = ['npx', '--yes', '--package', '@anthropic-ai/claude-code@2.1.325', 'claude', 'plugin', 'test', 'mods/context-memory']
results = []
for i in range(args.replicas):
    start = time.perf_counter()
    run = subprocess.run(command, cwd=args.root, env={**os.environ, 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS': '1'}, capture_output=True, text=True)
    results.append({'replica': i, 'seconds': time.perf_counter() - start, 'exitCode': run.returncode})
    if run.returncode:
        raise SystemExit(run.stdout + run.stderr)
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
report = {'schemaVersion': 1, 'arm': args.arm, 'platform': platform.platform(), 'command': command, 'runs': results,
          'childMaxRssRaw': usage.ru_maxrss, 'rssUnit': 'bytes' if platform.system() == 'Darwin' else 'KiB',
          'rssScope': 'child process high-water mark including npx; not isolated hook memory',
          'tokens': None, 'costUsd': None, 'liveStatus': 'not run: live budget unset',
          'note': 'Suite latency includes startup; B and C suites differ. No token or live continuity claims.'}
args.output.write_text(json.dumps(report, indent=2) + '\n')
