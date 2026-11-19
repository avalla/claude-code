# Quick start: running context-memory

Both ways below need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, because function
hooks are still experimental.

## 1. Quick trial, without installing

Start Claude from the folder of the project you want to work on, and point it
at the plugin:

```sh
cd /path/to/your/project
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /absolute/path/to/claude-code/mods/context-memory
```

The folder you start Claude from selects the project. `--plugin-dir` only
selects which plugin to load.

## 2. Permanent install, for every project

From the repository root, build a local marketplace into an empty folder
outside the checkout:

```sh
python3 scripts/build-context-memory-marketplace.py ~/context-memory-marketplace
claude plugin marketplace add ~/context-memory-marketplace
claude plugin install context-memory@avalla-context-memory --scope user
claude plugin list
```

From then on, in any project:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
```

To avoid typing the variable every time, add
`export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` to your `~/.zshrc`. With the plugin
installed, do not also pass `--plugin-dir`, or it is loaded twice.

## Commands in a session

| Command | What it does |
| --- | --- |
| `/context-pin add <text>` | Add a pin: an instruction of yours that holds for the whole session |
| `/context-pin` or `/context-pin list` | List the pins |
| `/context-pin remove <n>` | Remove pin number n |
| `/context-pin clear` | Remove all pins |
| `/context-handoff` | Show the latest checkpoint, the pins and the archive folder |

The model uses the `context_notes` (checkpoint), `context_history` and
`context_usage` tools on its own. At 75% and 90% of the context it gets a
reminder to save its checkpoint.

## Update and uninstall

**Update:** build the marketplace into a new empty folder, remove the old
marketplace registration, add the new one, reinstall and restart Claude.

**Uninstall:**

```sh
claude plugin uninstall context-memory@avalla-context-memory --scope user
```

Uninstalling does not delete the session data saved under `context-memory/`.

For details see [INSTALLATION.md](INSTALLATION.md) and the
[README](../README.md).
