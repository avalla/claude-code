# Context memory

A local function-hook plugin for operational session memory: a small checkpoint
stays in context, and older text can be retrieved in bounded pages. This is
separate from Claude Code's auto memory for reusable project knowledge.

## Run

Function hooks are experimental and must be enabled for this process. From the
repository root:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./mods/context-memory
```

To work in another project, start Claude from that project's directory and
point `--plugin-dir` at the absolute path of this plugin. For this checkout:

```sh
cd /path/to/your/project
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /Users/andrea/dev/tmp/claude-code/mods/context-memory
```

The current directory selects the project; the plugin path only selects the
extension to load. Adjust the absolute plugin path if you move this checkout.

Verified with Claude Code **2.1.325**. To try that version without replacing your
installed CLI:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 npx --yes --package @anthropic-ai/claude-code@2.1.325 claude --plugin-dir ./mods/context-memory
```

The system CLI used during development was 2.1.285. Its plugin test kit lacks
`mock.session`, which the archive tests require; run the suite with 2.1.325.
The plugin is opt-in, is not bundled into the engine, and requires no new runtime
dependencies. No global settings or installed CLI binaries are changed.

## Use

Ask Claude to update its checkpoint before compaction or a handoff. The plugin
also reminds it on user submissions when the reported context fill is at least
75%. This is a reminder, not a guarantee the model will save a checkpoint.

| Tool / command | Behavior |
| --- | --- |
| `context_notes` | Omit `text` to read; provide `text` to replace; `""` clears. Maximum 16,384 UTF-8 bytes. |
| `context_history` | Optional literal, case-insensitive `query`; optional numeric `cursor` for the next search page. |
| `context_history` with `id` | Read one record, optionally at `offset`; follow `nextOffset` until null. |
| `context_usage` | Current context usage and locally estimated breakdown, without token-count API requests. |
| `/context-handoff` | Print the latest checkpoint and local archive directory. Copy the checkpoint into a new session explicitly. |

Tools are exposed under `mcp__context-memory__<tool>` and use the engine's default
tool deferral. A checkpoint should include the objective, constraints, decisions,
changed files, actual verification, unresolved work and next steps. Notes are
reference data, never fresh authorization. Subagents cannot use the main
session's memory tools.

On the first context build and after native compaction, `prompt.context` injects
the saved checkpoint beside the existing context blocks. A replacement made by
`context_notes` is visible immediately in that tool's result; it is loaded from
disk on the next context build. `/resume` of the same session reads the same
files. A new session gets its own checkpoint; there is no implicit import of
another session's decisions.

## Storage and retrieval contract

Files live under
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/context-memory/<encoded-session-id>/`:

- `notes.txt`: the current checkpoint.
- `history/000000000001.json`, etc.: an ordered, best-effort text index of main
  session rows observed after loading the plugin. Reloading resumes numbering.

The transcript remains authoritative. The index is **not a lossless backup**:
it excludes image and thinking blocks and subagent transcripts, includes text
and tool call/result references, and caps each record at 32,768 UTF-16 code
units. `truncated` and `originalChars` expose that cap on record reads. Earlier
rows from before the plugin loaded are not backfilled. No disk retention or
deletion policy runs automatically; delete an inactive session's directory to
remove its checkpoint and index. Files contain local conversation text.

Search reads at most 100 records and returns at most 10 excerpts of 500 code
units per call. Follow `nextCursor`, including after an empty search page. Each
record read returns at most 12,000 code units; offsets are UTF-16 code units.
Directory enumeration still scales with the number of archived records. Search
cursors assume records are append-only and that one process writes the session.

Archive failures do not stop the conversation and are reported in history
results and handoff output as `archiveError`. Notes errors are returned to the
caller. The file API offers whole-file writes, without an atomic-rename or
locking contract; this plugin does not claim transactional storage across
processes or crash recovery.

## Boundaries and verification

Native `/compact` and automatic compaction stay in charge. There is no selective
compaction, automatic context replacement, or CLM rollover in this version.
Those require separate guarantees around preserved user instructions, full
history and tool use/result pairing. The text index is never replayed into the
engine's message protocol.

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 npx --yes --package @anthropic-ai/claude-code@2.1.325 claude plugin test mods/context-memory
npx --yes --package typescript@5.9.3 tsc -p mods/tsconfig.json
```

The tests exercise the engine's hook dispatcher with mocked storage and usage:
checkpoint persistence and UTF-8 limits, context injection, ordered archival and
reload numbering, paginated retrieval, storage failure isolation, registration,
handoff, the 75% reminder and local usage estimates. This does not establish
long-running live-session behavior, model compliance or measured token savings.
