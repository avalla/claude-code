#!/usr/bin/env python3
"""Build an isolated local marketplace from the canonical plugin source."""
import argparse
import json
import shutil
from pathlib import Path


def build(output: Path, source: Path | None = None) -> None:
    source = source or Path(__file__).resolve().parents[1] / 'mods/context-memory'
    if output.is_symlink() or (source / 'hooks').is_symlink():
        raise ValueError('Symlink root is not supported')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output must be empty; existing files are preserved')
    paths = [source / '.claude-plugin/plugin.json', source / 'README.md']
    paths += sorted((source / 'hooks').rglob('*'))
    for path in paths:
        if path.is_symlink() or source.resolve() not in path.resolve().parents:
            raise ValueError(f'Unsafe source path: {path}')
    for path in paths:
        if not path.is_file():
            continue
        destination = output / 'plugins/context-memory' / path.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
    catalog = output / '.claude-plugin/marketplace.json'
    catalog.parent.mkdir(parents=True, exist_ok=True)
    catalog.write_text(json.dumps({'name': 'avalla-context-memory', 'owner': {'name': 'avalla'}, 'plugins': [{'name': 'context-memory', 'source': './plugins/context-memory'}]}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    build(parser.parse_args().output)
