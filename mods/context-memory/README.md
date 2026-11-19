# Context memory

A local function-hook plugin for operational session memory: a small checkpoint
stays in context, and older text can be retrieved in bounded pages. This is
separate from Claude Code's auto memory for reusable project knowledge.

The [implementation plan](IMPLEMENTATION-PLAN.md) (in Italian) describes five
improvements, their dependencies, tests and acceptance criteria.

For a short guide to running, installing and using the plugin, see the
[quick start](docs/QUICKSTART.md). For why the plugin should improve context
management and an estimate of its token costs and savings, see
[Context and tokens](docs/CONTEXT-AND-TOKENS.md).

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
also reminds it after tools and on user submissions at 75% and 90%, once per
threshold until a successful native compaction. This is a reminder, not a guarantee the model will save a checkpoint.

| Tool / command | Behavior |
| --- | --- |
| `context_notes` | Omit `text` to read; provide `text` to replace; `""` clears. Maximum 16,384 UTF-8 bytes. |
| `context_history` | Optional literal, case-insensitive `query`; optional numeric `cursor` for the next search page. |
| `context_history` with `id` | Read one record, optionally at `offset`; follow `nextOffset` until null. |
| `context_usage` | Current context usage and locally estimated breakdown, without token-count API requests. |
| `/context-handoff` | Print the latest checkpoint, the session pins and local archive directory. Copy the checkpoint into a new session explicitly. |
| `/context-pin` or `/context-pin list` | List your session pins. |
| `/context-pin add <text>` | Append a pin. At most 16 pins, each non-empty and at most 1,024 UTF-8 bytes, 8,192 bytes in total. |
| `/context-pin remove <n>` | Remove pin `n` (1-based, as listed). An index outside `1..count` is refused. |
| `/context-pin clear` | Remove all pins. Also replaces an unreadable `pins.json`. |

Tools are exposed under `mcp__context-memory__<tool>` and use the engine's default
tool deferral. A checkpoint should include the objective, constraints, decisions,
changed files, actual verification, unresolved work and next steps. Notes are
reference data, never fresh authorization. Subagents cannot use the main
session's memory tools, but they do receive the main session's cached
`prompt.context` blocks (checkpoint and pins) read-only: the hook API gives
`prompt.context` no agent id to filter on (observed live with 2.1.325).

## Session pins

Pins are instructions you write that hold for the whole session. They are kept
apart from the model's checkpoint: the model writes `context_notes`, only you
write pins. No tool lets the model create, change or remove a pin. `add`,
`remove` and `clear` also refuse any run whose origin is not your own prompt
(`composer`, `bridge` or `sdk`); a plugin, peer or unclassified run may only
`list`. Claude Code 2.1.325 already refuses the model's own `Skill` call of
`/context-pin`.

The model gets the list in a `<user_session_constraints>` block, separate from
the checkpoint block. That block says the pins are the user's instructions, that
the list replaces all previous pins, and that pins do not change tool
permissions. Unlike the notes, pins are not labelled as fallible reference data.
Each pin is a JSON string; `<` is escaped, so a pin cannot close the block.

- A change reaches the conversation already under way through the command's
  context, from the next model request.
- On the first context build and after native compaction, `prompt.context`
  reloads `pins.json` beside the checkpoint. An empty list adds no block.
- After a save the plugin drops the cached `prompt.context` answer, so a
  subagent started later gets the current list rather than a superseded one.

`pins.json` holds `{schema_version: 1, revision, items}`. Each save writes
`pins.json.tmp` and renames it over `pins.json`. `$.fs` has no rename, so the
rename runs `mv -f --` through `$.process.run` (argv, no shell). This relies on
POSIX `rename(2)` within one directory and is not available on Windows. If the
rename fails, the previous file stays and the error is reported. `revision` is
one above the highest revision readable in the file or written by this process,
so it keeps increasing across `clear`, imports and recovery.

If `pins.json` is corrupt, has an unknown `schema_version` or unknown fields,
or breaks a limit, nothing is guessed. The context block says the pins cannot be
read and asks for `/context-pin clear`. `list`, `add` and `remove` fail with the
same advice; `clear` works and writes a fresh revision.

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
- `pins.json`: the user's session pins (see [Session pins](#session-pins)).
- `history/000000000001.json`, etc.: an ordered, best-effort text index of main
  session rows observed after loading the plugin. Reloading resumes numbering.

The transcript remains authoritative. The index is **not a lossless backup**:
it excludes image and thinking blocks and subagent transcripts, includes text
and tool call/result references, and caps each searchable index record at 32,768 UTF-16 code
units. Version 2 records additionally store long text in separate blocks. `truncated` and `originalChars` expose that cap on record reads. Earlier
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
processes or crash recovery. `pins.json` is the exception that gets a
temporary-file-and-rename write; writers are serialized within one process only.

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
handoff, the 75% reminder and local usage estimates. `tests/pins.test.ts` covers
pin parsing, limits, atomic persistence and revisions, corrupt-file recovery,
reinjection after compaction, the absence of a model write path and the handoff
round trip. This does not establish long-running live-session behavior, model
compliance or measured token savings.

## Version 0.2 additions

- Native compaction snapshots the current notes under `checkpoints/` and gives
  the summarizer reference data. Skipped/precompute compactions do not reset
  reminder thresholds. No synthetic summary replaces the notes.
- `context_history` accepts `view: "full"` with `id` and optional `offset`.
  Follow `nextOffset` for exact text; pages avoid splitting valid emoji pairs.
  Search still covers only the index prefix. Legacy truncated records report
  `legacy_truncated`; incomplete new archives report unavailable. At most 10,000
  blocks (12,000 UTF-16 units each) are captured per record; failures preserve
  the short index and report the archive error. No old transcript backfill runs.
- `/context-handoff --export` prints a source-session/export reference.
  `/context-import SESSION:EXPORT` previews it;
  add `--apply` to import, `--replace` to overwrite nonempty notes, and
  `--allow-cross-project` for a different or unknown cwd. Export-time Git
  provenance and a replacement backup are retained. Imported text is reference
  data and must be verified.
- `context_usage.memory` reports saved-at (current process only), reminder
  thresholds and checkpoint diagnostics.

## Version 0.3 additions

- `/context-pin` and `pins.json`, described in [Session pins](#session-pins).
- `/context-handoff --export` also exports the session pins and refuses to export
  while `pins.json` is unreadable. The bundle limit is now 64 KiB, enough for a
  16 KiB checkpoint, 8 KiB of pins and provenance.
- `/context-import` previews the pins. Only `--apply`, from your own prompt,
  writes them; `--apply` from a plugin or peer origin is now refused for every
  bundle, including notes-only ones. Applying refuses to overwrite different nonempty pins without
  `--replace`, and refuses an unreadable destination `pins.json`. It backs up
  the pins it replaces under `checkpoints/before-import-*.pins.json`. Bundles
  exported before 0.3 carry no pins and leave the destination's pins unchanged.
  Pins are written before notes; a later notes failure leaves the imported pins
  in place and reports the error.

[Personal installation](docs/INSTALLATION.md) keeps Claude's working directory
at the project you choose, without requiring `--plugin-dir`.
[Verification](docs/VERIFICATION.md) distinguishes dispatcher tests from live
acceptance. [Benchmark results](docs/BENCHMARK-RESULTS.md) report local measurements;
model token savings and live continuity remain unmeasured.
