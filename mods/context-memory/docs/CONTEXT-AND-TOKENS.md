# Why context-memory helps, and what it costs in tokens

This is a design rationale and an estimate. Token usage has **not** been
measured; see [Benchmark results](BENCHMARK-RESULTS.md) for what has been.

## The problem

When the context fills up, Claude Code compacts it: the conversation is replaced
by a summary. The summary can lose decisions, constraints and instructions given
early in the session, so after compaction the model may redo work or forget what
it was asked.

## What the plugin does about it

- **Working state survives compaction.** The model writes its own checkpoint
  (`context_notes`) deliberately, before the context shrinks. The checkpoint is
  injected back verbatim on the first context build and after every native
  compaction, instead of depending on an automatic summary. Reminders at 75% and
  90% prompt the model to update it.
- **Your instructions stay yours.** Session pins (`/context-pin`) are separate
  from the model's notes, only the user can write them, and they are presented
  as user instructions, not as reference data. They are reinjected after
  compaction.
- **The context stays lean.** Older detail lives on disk in a searchable index
  (`context_history`) and is retrieved in bounded pages only when needed,
  instead of being kept in context just in case.

In short: keep little, well-chosen state in context, and retrieve the rest on
demand.

## Where it adds tokens

Estimates use about 4 characters per token; languages other than English often
need more tokens for the same text.

| Item | Size | When |
| --- | --- | --- |
| Checkpoint in context | up to 16 KB, about 4,000 tokens | every request after the first context build or a compaction |
| Pins in context | up to 8 KB, about 2,000 tokens; usually a few lines | every request, when pins exist |
| Writing the checkpoint | the whole text, as **output** tokens | each `context_notes` replacement |
| Archive reads | search: up to 10 excerpts of 500 code units, about 1,250 tokens; record read: up to 12,000 code units, about 3,000 tokens | only when the model asks |
| 75% and 90% reminders | a few dozen tokens | twice per compaction cycle |
| Tool definitions | small, deferred by default | when used |

Two things soften the cost:

- **Prompt caching.** The injected block stays identical until the next
  compaction: a `context_notes` replacement is visible in that tool's result and
  is loaded from disk only on the next context build. The block can therefore be
  read from the prompt cache, which costs much less than uncached input.
- **The real cost is output.** Each checkpoint replacement regenerates the whole
  text, and output tokens cost more than input tokens. A short checkpoint,
  updated at the reminders or before a handoff, keeps this low.

## Where it can save tokens

- **Less rework after compaction.** Without a checkpoint the model tends to
  reread files, rerun commands and revisit settled decisions, which can cost
  tens of thousands of tokens, far more than a 4,000-token checkpoint.
- **Fewer repeated instructions.** With pins, the user does not restate
  constraints after each compaction, and the model does not make mistakes from
  forgetting them.
- **Targeted retrieval.** The model fetches only the excerpt it needs instead of
  keeping everything in context or rereading the transcript.

## Expected balance

- **Short sessions without compaction:** the plugin costs slightly more tokens;
  it adds overhead with no benefit.
- **Long sessions with one or more compactions:** savings are likely, if the
  checkpoint avoids even one round of re-exploration.
- The plugin does not reduce per-request usage; it tends to raise it slightly.
  The expected gain is on the session total: fewer tokens spent on repeated
  work and errors.

## How to measure it

Run the same long task, long enough to trigger at least one compaction, once
with the plugin and once without. Compare:

- total input, output and cache tokens (`/cost` or the console);
- how often the same files are reread;
- whether the initial constraints are respected after compaction.

The scenario is set up in [`benchmarks/scenarios.json`](../benchmarks/scenarios.json);
set the model, access and an explicit budget before running the live campaign.
