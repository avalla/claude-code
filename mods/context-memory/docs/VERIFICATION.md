# Implementation evidence — 2026-11-14

Baseline: `6288350`; macOS arm64; CLI pinned to `2.1.325`, TypeScript `5.9.3`.
Existing untracked `mods/context-memory/tsconfig.json` is preserved unchanged;
checks use `mods/tsconfig.json`.

## Checks performed

- Baseline: 14 dispatcher tests passed; shared typecheck passed; plugin validation
  passed with author/icon/catalog advice warnings.
- Current: dispatcher suite expanded to 21 tests, including concurrent threshold
  delivery, surrogate-safe full-text round trip, missing blocks, malformed
  metadata, legacy records, compaction snapshot/skip/precompute and explicit import.
- Scale: 100 searches at each of 1,000 and 10,000 records; each search reads
  exactly 100 records. Directory enumeration still scales with total records.
- Python builder tests cover package completeness, populated output preservation,
  space-containing paths and source symlink rejection.
- Generated marketplace validated; add/install/list succeeded using a temporary
  `CLAUDE_CONFIG_DIR` and a path with spaces. Installed version: `0.2.0`, user scope.
- Hook compiler actually loads all imported modules in the dispatcher tests.
  It requires helpers receiving `$` at module scope; nested helpers were moved.
- No global installation, shell edits or CLI upgrade were performed.

## Capability and acceptance matrix

| Phase | Implemented/verified | Remaining acceptance |
| --- | --- | --- |
| P0 | Baseline tests, types, manifest and dispatcher contracts | Live model smoke |
| M1 | 75/90% dedup, tool context preservation, snapshots and compaction pass-through | Model receives/obeys reminders in a real chain |
| M2 | Chunked text and bounded page reads, legacy availability, schema validation | Larger live tool output; exhaustive filesystem fault campaign |
| M3 | Export, preview/apply, replacement backup, cwd and Git provenance | Transfer between two live sessions/worktrees |
| M4 | Builder and isolated native user installation | Two live project launches, disable/restart acceptance |
| M5 | Scenario manifest, runner, baseline/current local measurements | Model A/B/C campaign; budget/model not set |

The automated suite uses the real hook dispatcher with mocked filesystem and
usage; it does not demonstrate model compliance or live continuity. Do not mark
all plan exit criteria complete. No model benchmark was run: the plan requires
an explicit spending ceiling and its manifest deliberately leaves it null.

## Known implementation limits

Search remains prefix-only. Full view reads a manifest capped at 1 MiB and
at most two 12,000-unit blocks per page. Symlink checks and stat/read are not
atomic. Storage is best effort, single writer, with no automatic retention.
Long-text capture can increase disk use and initial message memory is unchanged.
Git provenance describes export time, not the time notes were authored. Preview
identities live in memory; apply validates again after a reload. Import copies
notes and, from 0.3, session pins; it never changes repository state. Session IDs for handoff references
must match `[A-Za-z0-9_-]+`; unsupported IDs fail explicitly.

# Session pins evidence — 2026-11-16

Baseline before the change: HEAD `6288350`, the uncommitted 0.2 working tree,
macOS arm64, system CLI 2.1.285, pinned CLI 2.1.325, TypeScript 5.9.3.
`tsc -p mods/tsconfig.json` exited 0; `claude plugin test mods/context-memory`
(2.1.325) reported 21 pass, 0 fail.

## Automated checks after the change

- `npx --yes --package typescript@5.9.3 tsc -p mods/tsconfig.json`: exit 0.
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 npx --yes --package @anthropic-ai/claude-code@2.1.325 claude plugin test mods/context-memory`:
  30 pass, 0 fail across 2 files: the 21 existing tests, with the registration
  test now expecting `context-pin`, plus 9 in `tests/pins.test.ts`.
- `claude plugin validate mods/context-memory` (2.1.325): passed with the same
  advisory warnings as before.
- `python3 -m unittest discover -s scripts/tests`: 2 tests OK. The builder copies
  `hooks/*`, so `pins.ts` is packaged.

`tests/pins.test.ts` uses the real hook dispatcher with mocked `fs.*` and a
`process.run` mock that performs `mv` as a rename. It covers:

- subcommand parsing and out-of-range or non-numeric indices;
- the 16-pin, 1,024-byte and 8,192-byte limits, including multi-byte boundaries;
- writes that only touch `pins.json.tmp`, and revisions 1 to 4 that continue from
  a stored revision 41;
- a failed rename that keeps the old file;
- three unreadable variants (truncated JSON, `schema_version: 2`, unknown field):
  `list`, `add` and `remove` refuse, the block reports them unreadable, and `clear`
  writes the salvaged revision + 1;
- reinjection after `session.compact` as a separate block, with the three
  required statements and an escaped closing tag;
- no registered pin tool, unknown `mcp__context-memory__*` calls and
  `context_notes` leaving `pins.json` unchanged, and non-user origins refused;
- the handoff round trip, including `--replace`, a backup, a plugin origin
  refused, an unreadable destination or source, and legacy bundles.

## Live session (2.1.325, `--plugin-dir`, cwd `/tmp/pin-live`)

Launched as in the README, in tmux, with the user's normal account. Trusting the
temporary folder was accepted at startup. Observed:

| Step | Result |
| --- | --- |
| `/context-pin add …ZEBRA-42` | Revision 1; `pins.json` on disk as specified; no `.tmp` left. |
| Ask the model, no tools | Quoted the `<user_session_constraints>` block verbatim and followed the pin. |
| Second `add` mid-session | The next reply followed both pins. |
| Ask the model to add a pin or run `/context-pin clear` with its tools | The model's `Skill(context-pin)` was refused by the engine ("runs only when you type it at the prompt"); `pins.json` stayed at revision 2. |
| `/compact`, then ask | The model quoted the block, with both pins, as separate from the compaction summary (which also paraphrased them). |
| Truncate `pins.json` by hand, then `list`, `add`, `remove`, `clear` | The first three printed the unreadable error with `/context-pin clear`; `clear` wrote revision 3 (salvaged 2 + 1). |
| Subagent after pin changes (first build) | **Saw the checkpoint block and a superseded pin list** from the cached `prompt.context` answer. |
| Same after adding `$.ui.invalidate('prompt.context')` on save (new session) | The subagent quoted the current list. The main conversation reported three copies (context build, then each command's context), with no extra resend from the invalidation. |

The "separate block after compaction" result is the model's own report; the raw
request was not inspected. Two sessions' data remain under
`~/.claude/context-memory/09c62f11-…` and `a90e0348-…`.

## Not verified or not achievable

- Subagents cannot be kept from seeing pins (or notes): `prompt.context` has no
  agent id, and `turn.step` pins its messages. They see a read-only copy. They cannot
  change pins: there is no tool, and command origins are checked.
- Windows: the rename relies on `mv`. Cross-process writers are not locked.
- A `/resume` in a new process, and a hot reload between a pin change and the
  next request, were not exercised live.
- Model compliance with pins is observed in a handful of turns, not measured.

Context7 was attempted and returned monthly quota exceeded. Contracts were
verified using local declarations, pinned CLI help, validator and dispatcher.
