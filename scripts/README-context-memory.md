# Context memory packaging

`build-context-memory-marketplace.py OUTPUT` generates a local personal
marketplace from `mods/context-memory` using the Python standard library.
OUTPUT must be empty. The script never installs or changes global settings.
See `mods/context-memory/docs/INSTALLATION.md` for installation and rollback.

Test: `python3 -m unittest discover -s scripts/tests -p test_context_memory_marketplace.py`.
