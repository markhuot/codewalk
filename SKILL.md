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
3. **Build a step** — narration and the diff that proves it, together in one step. You supply the diff on stdin (see [Getting diffs](#getting-diffs)); the prose rides in `--note`; every step shows code. Keep each to one file and the smallest hunk that makes the point:
   ```
   printf '@@ -40,0 +42,4 @@\n+  if (!process.stdout.isTTY) return;\n+  split(pane);\n+  render(step);\n+  block();\n' \
     | walk diff --path src/walk.ts --title "The new interface" \
        --note "This makes **live** diff narration possible. Here's the interface a caller uses." \
        --comment:42 "this gate short-circuits when there's no TTY"
   ```
4. **Present it and wait for a reply.** This is the heart of the tool — it blocks and prints the human's comment:
   ```
   walk present
   ```
   Read what comes back, answer it in chat, then build and present the next step. Repeat until the walk is done.
5. **Finish the walk.** After the last step's reply, call `walk finish "<optional one-line summary>"`. The reviewer shows a completion screen and the pane closes itself; the browser shows an "all steps reviewed" screen. Don't leave a walk dangling on its final step — always finish it so the ending feels deliberate.

`present` puts the **latest** step on stage by default (pass `--step <id>` to re-present an earlier one). A running reviewer advances to whatever you present next, so the human always sees the change you're talking about.

## Render targets

`walk present --render <target>`:

| Target | What happens | When |
|---|---|---|
| `pane` | Splits a pane beside you (herdr or tmux), renders the step, and blocks for a typed comment. **Default inside a multiplexer.** | You're in a herdr or tmux session (the usual case). |
| `web` | Starts the live browser view; the human clicks lines to stage comments, then clicks **Complete step** to send them. Add `--open` to open the browser. | No multiplexer, or the human prefers a browser. |
| `cli` | Prints a rich inline diff to stdout. Does **not** block — the reply is simply the human's next chat message. **Default with no multiplexer.** | You can't open a pane or browser (e.g. running headless inside another tool). |

Other flags: `--no-wait` (present without blocking), `--timeout <sec>` (give up waiting and return control), `--port <n>` (web port, default 4599).

## Getting diffs

`walk diff` never fetches — **you** produce the diff and pipe it in on stdin, then name the file with `--path`. Get the hunk however fits: a local `git`/`gh` command, an API/CLI pull from a repo you never cloned, or a hunk you write by hand for a change that doesn't exist yet. This is what lets you walk a remote PR or a *planned* change, not just local work.

Two accepted stdin shapes:

| Shape | What you pipe | Notes |
|---|---|---|
| **bare hunk** (the norm) | `@@ -0,0 +47,3 @@` + `+`/`-`/space lines | the `diff --git`/`---`/`+++` envelope is synthesized from `--path`; added/deleted/modified is inferred from the hunk header |
| **full file diff** | a complete `diff --git …` block | used as-is; the path comes from the diff, so `--path` is optional |

Author a real hunk header — the `+47` in `@@ -0,0 +47,3 @@` is what makes the gutter start at line 47 instead of 1. To slice one file out of a bigger diff: `gh pr diff 17 -R owner/repo | <keep the one file's hunk> | walk diff --path <file>`.

**Build the hunk inline; never write a temporary helper script.** Producing a hunk is a one-liner with standard tools, right in the command — don't create a `slice.mjs` / `hunk.sh` scratch file to do it. Pipe a real diff when you have one, or construct a bare hunk from a file on disk with `sed`:

```sh
# A real change: let git/gh emit the hunk, pipe it straight in.
git diff HEAD -- src/cli.ts | walk diff --path src/cli.ts --title "…"

# Showing a region of an existing file as an added block: prefix with sed, no script.
{ echo "@@ -0,0 +41,31 @@"; sed -n '41,71p' src/diff/author.ts | sed 's/^/+/'; } \
  | walk diff --path src/diff/author.ts --title "…"
```

Decorate a diff step with `--title`, `--note "<markdown>"`, and comments — repeat `--comment "line:message"`, or use `--comment:<line> "message"` (append `:old` for the old side, e.g. `--comment:12:old "…"`). **Show the smallest hunk that makes the point** — one file per step, ~15-20 lines. A good walk is a sequence of small, captioned diffs, not one giant dump.

## Handling replies

`walk present` (and `walk await`) print the reply in a delimited block tagged with its source and the step it's about. Treat it as the human talking to you: answer the question, make the change they asked for, or just acknowledge and continue. If you need to wait again without presenting a new step, `walk await --timeout <sec>`.

## Other commands

- `walk comment <line> "<msg>" [--side old|new] [--step <id>]` — attach an inline comment to a diff step after the fact (the file is taken from the step).
- `walk reply "<text>"` — record a reply yourself (mostly for tooling/tests).
- `walk finish "<summary>"` — end the walk: completion screen in the reviewer, then the pane closes; the browser shows an all-reviewed screen. Call this after the final step.
- `walk render [--format html|ansi] [--out <file>]` — static render of the whole walk (no interaction).
- `walk list` / `walk walks` / `walk use <id>` / `walk status` — inspect and switch walks.
- `walk stop` — force-close the reviewer pane and stop the server (finish is the graceful way to end).

## Shape of a good step: text-first, code-light

**Every step must show code or a concrete example — never prose alone.** A step is narration *plus* the diff that proves it, shown together. Put the context in the diff step's `--note` (and point at lines with `--comment`); don't create a standalone `walk say` step for an intro, a transition, or a summary. A step with no code on screen reads as empty and confusing — there is nothing for the reader to look at or react to. If you have something to say, attach it to the code it's about.

**Lead with prose, then show a small diff.** Within a step, open with a paragraph or two of context (`--note`), then roughly **15–20 lines of code** — the specific lines that make the point. The narration frames the walk; the diff is the evidence, and it's always present.

If a step shows more than ~20 lines of code, assume the human will not read all of it, and treat that as a signal to either split the step or narrate what to look for. When a change is genuinely large, say so and point at the two or three lines that matter rather than dumping the whole thing.

Levers for keeping diffs small:
- One file per step (one `--path`) is the norm, not the exception.
- You control the hunk you pipe in, so pipe only the lines that matter — author a tight `@@` hunk, or slice a region out of a bigger diff before it reaches `walk diff`.
- For a new/large file, show one region per step: a hunk like `@@ -0,0 +47,18 @@` renders just lines 47-64, with the gutter numbered correctly.
- Split a big file across several steps, each narrating one region.

## Style for narration (the `--note` and `--comment` text)

The voice of a senior engineer giving a tour: lead with what the change enables, then point at the specific code. Short paragraphs, markdown welcome (bold, `code`, lists, blockquotes). Don't restate the diff line by line — it's already on screen. Explain the *why* and the non-obvious, and end steps in a way that invites a reaction ("does this hold up for the streaming case?").

(`walk say` still exists, but it creates a prose-only step with no code — avoid it in a walk. Narration belongs in a diff step's `--note`.)

## You pace the walk, and you can change it as you go

The reviewer (pane or browser) shows **one step at a time** — the step you last presented. The reader can't skip ahead, so the walk moves at your pace: present a step, read the reaction, then present the next. Advance only when you're ready.

The walk is not frozen once it starts. Revise it freely in response to what the human says:
- They want less: add a tighter step (a smaller `--files` scope or `--context 0`) and present that instead.
- They're confused: `walk say` a clarification, or `walk comment` the exact line, then present it.
- They ask about something you haven't shown: build the relevant diff step now and present it, even if it wasn't in your original plan.
- They correct you: acknowledge it, add a follow-up step with the right framing, and move on.
- Re-present an earlier step any time with `walk present --step <id>` to revisit it.

Because only the focused step is shown, extra or superseded steps don't clutter the reader's view — so don't hesitate to insert, re-scope, or reorder as the conversation goes. A walk is a conversation, not a script you read start to finish.

## Presenting: always call it inline (never in the background)

`walk present` blocks and prints the human's reply to stdout when the wait ends. Run it **inline, in the foreground, for every render target — pane, web, and cli alike.** The reply then comes straight back to you as the command's output. Do not background it (and do not background `walk await`): a backgrounded call writes to a file you then have to go read, which adds a whole extra round-trip for no benefit. Pass `--timeout <sec>` (≤ 600, the Bash tool's ceiling) so a long silence returns control instead of hanging, and just call `present` again to keep waiting.
