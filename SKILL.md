---
name: codewalk
description: Walk a human through a PR, branch, or code change as a back-and-forth conversation — render inline diffs with per-line comments, then block for their reply and respond. Use when the user asks to be walked through / shown / explained a PR, branch, feature, or set of changes ("walk me through PR #17", "show me what changed on this branch", "explain this feature"). Renders to a live herdr pane, the browser, or inline terminal text, and pipes the human's comments back into the conversation.
---

# codewalk

`codewalk` turns a diff into a **narrated, two-way walkthrough**. You interleave prose ("this change makes X possible") with rendered diffs of the specific files that matter, put one change "on stage" at a time, and then **block until the human reacts** — their comment comes back to you as the command's output, so you can answer it and move on. It's a conversation, not a report you hand over.

## The command

The binary is `walk`. During development run it as `bun run <repo>/src/cli.ts <args>`, or after `bun link` just `walk <args>`. State lives in `.codewalk/` in the current directory; there's one active walk at a time and commands append to it.

## The loop

1. **Get oriented.** Read the change first so your narration is accurate: `gh pr view <n>`, `gh pr diff <n>`, `git log`, `git diff main...HEAD`. Understand *why* it exists before you narrate it.
2. **Start a walk:**
   ```
   walk start "PR #17: streaming diff narration"
   ```
3. **Build a step** — a bit of prose plus the diff that proves it. Keep each step to one or two files:
   ```
   walk say "This makes **live** diff narration possible. Here's the interface a caller uses:"
   walk diff --pr 17 --files src/walk.ts --title "The new interface" \
        --comment "src/walk.ts:42:this gate short-circuits when there's no TTY"
   ```
4. **Present it and wait for a reply.** This is the heart of the tool — it blocks and prints the human's comment:
   ```
   walk present
   ```
   Read what comes back, answer it in chat, then build and present the next step. Repeat until the walk is done.

`present` puts the **latest** step on stage by default (pass `--step <id>` to re-present an earlier one). A running reviewer advances to whatever you present next, so the human always sees the change you're talking about.

## Render targets

`walk present --render <target>`:

| Target | What happens | When |
|---|---|---|
| `pane` | Splits a herdr pane beside you, renders the step, and blocks for a typed comment. **Default inside herdr.** | You're in a herdr session (the usual case). |
| `web` | Starts the live browser view; the human types in a composer and clicks "Send to Claude". Add `--open` to open the browser. | No herdr, or the human prefers a browser. |
| `cli` | Prints a rich inline diff to stdout. Does **not** block — the reply is simply the human's next chat message. **Default outside herdr.** | You can't open a pane or browser (e.g. running headless inside another tool). |

Other flags: `--no-wait` (present without blocking), `--timeout <sec>` (give up waiting and return control), `--port <n>` (web port, default 4599).

## Getting diffs

`walk diff` accepts one source:

| Source | Flag | Notes |
|---|---|---|
| GitHub PR | `--pr <n>` | uses `gh pr diff <n>` |
| git range | `--from <ref> [--to <ref>]` | `from..to`; omit `--to` to diff against the working tree (untracked files included) |
| staged | `--staged` | `git diff --cached` |
| raw stdin | `--stdin` | pipe any unified diff: `git show <sha> \| walk diff --stdin` |
| limit paths | `--files a b ...` | combine with `--from`/`--staged` to scope to specific files |

Decorate a diff step with `--title`, `--note "<markdown>"`, and repeatable `--comment "path:line:message"`. **Show the smallest diff that makes the point** — prefer `--files` to focus each step on one or two files. A good walk is a sequence of small, captioned diffs, not one giant dump.

## Handling replies

`walk present` (and `walk await`) print the reply in a delimited block tagged with its source and the step it's about. Treat it as the human talking to you: answer the question, make the change they asked for, or just acknowledge and continue. If you need to wait again without presenting a new step, `walk await --timeout <sec>`.

## Other commands

- `walk comment <path> <line> "<msg>" [--side old|new] [--step <id>]` — attach an inline comment to a diff step after the fact.
- `walk reply "<text>"` — record a reply yourself (mostly for tooling/tests).
- `walk render [--format html|ansi] [--out <file>]` — static render of the whole walk (no interaction).
- `walk list` / `walk walks` / `walk use <id>` / `walk status` — inspect and switch walks.
- `walk stop` — close the reviewer pane and stop the server when the walk is done.

## Shape of a good step: text-first, code-light

**Lead with prose, then show a small diff.** Each step should be a paragraph or two of context followed by roughly **15–20 lines of code** — the specific lines that make the point. The narration is the walk; the diff is evidence for it.

If a step shows more than ~20 lines of code, assume the human will not read all of it, and treat that as a signal to either split the step or narrate what to look for. When a change is genuinely large, say so and point at the two or three lines that matter rather than dumping the whole thing.

Levers for keeping diffs small:
- `--files <one file>` — one file per step is the norm, not the exception.
- `--context <n>` — fewer context lines around each change (default 3). Use `--context 0` or `1` for a tight view.
- Pre-slice with `--stdin` when you want an exact hunk: `git diff main -- src/foo.ts | <select the lines> | walk diff --stdin`.
- Split a big file across several steps, each narrating one region.

## Style for narration (the `say` and `--note` text)

The voice of a senior engineer giving a tour: lead with what the change enables, then point at the specific code. Short paragraphs, markdown welcome (bold, `code`, lists, blockquotes). Don't restate the diff line by line — it's already on screen. Explain the *why* and the non-obvious, and end steps in a way that invites a reaction ("does this hold up for the streaming case?").

## Presenting: call it inline, not in the background

`walk present` blocks and prints the human's reply to stdout when the wait ends. Run it **inline** (in the foreground) so that reply comes straight back to you as the command's output — don't background it and poll a file, that just adds latency. Pass `--timeout <sec>` (≤ 600) so a long silence returns control instead of hanging.
