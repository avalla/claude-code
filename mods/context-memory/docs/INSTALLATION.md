# Install for every local project

Build a local marketplace from the canonical source. Choose an empty directory
outside this checkout and keep it for future updates:

```sh
python3 scripts/build-context-memory-marketplace.py /absolute/path/to/context-memory-marketplace
claude plugin marketplace add /absolute/path/to/context-memory-marketplace
claude plugin install context-memory@avalla-context-memory --scope user
claude plugin list
```

The builder copies only runtime hooks, manifest and README. It refuses populated
output directories and never edits shell or Claude settings. The subsequent
CLI commands install into the selected Claude configuration (the default is
your personal configuration). Management commands were verified with 2.1.325.

Start Claude **in the project you want to work on**:

```sh
cd '/path/to/my project'
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
```

Function hooks still require the experimental environment gate. To avoid setting
it per invocation you may explicitly add `export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`
to your shell configuration. The installer does not do this automatically.
Do not also load the same plugin with `--plugin-dir`.

For an isolated trial, set `CLAUDE_CONFIG_DIR` to a temporary directory for all
management and launch commands. Validate the generated marketplace with
`claude plugin validate /absolute/path/to/context-memory-marketplace`.
The install/list trial is verified; live model sessions in two folders remain
an acceptance check (see VERIFICATION.md).

To update, build into a new empty directory, remove the old local marketplace
registration, add the new directory and reinstall using the same commands.
Keep the old package until the replacement works. Restart Claude after updates.
To disable or remove:

```sh
claude plugin disable context-memory@avalla-context-memory
claude plugin uninstall context-memory@avalla-context-memory --scope user
```

These commands do not remove saved session data under `context-memory/`.
