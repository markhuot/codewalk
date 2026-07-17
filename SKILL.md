---
name: codewalk
description: Walk a human through a PR, branch, or code change as a back-and-forth conversation — render inline diffs with per-line comments, then block for their reply and respond. Use when the user asks to be walked through / shown / explained a PR, branch, feature, or set of changes ("walk me through PR #17", "show me what changed on this branch", "explain this feature"). Renders to a live herdr pane, the browser, or inline terminal text, and pipes the human's comments back into the conversation.
---

# codewalk

`codewalk` turns a diff into a **narrated, two-way walkthrough**. You interleave prose ("this change makes X possible") with rendered diffs of the specific files that matter, put one change "on stage" at a time, and then **block until the human reacts** — their comment comes back to you as the command's output, so you can answer it and move on. It's a conversation, not a report you hand over.

## The command

The binary is `walk`. During development run it as `bun run <repo>/src/cli.ts <args>`, or after `bun link` just `walk <args>`. State lives in `.codewalk/` in the current directory. There's one active walk with a single step on stage at a time — the tool keeps no backlog, so you author and present each step live.

## The loop

1. **Get oriented.** Read the change first so your narration is accurate: `gh pr view <n>`, `gh pr diff <n>`, `git log`, `git diff main...HEAD`. Understand *why* it exists before you narrate it.
2. **Start a walk:**
   ```
   walk start "PR #17: streaming diff narration"
   ```
3. **Present a step** — one call builds the step from the diff you pipe in, puts it on stage, and blocks until the human replies (the reply prints to stdout). The prose rides in `--note`; every step shows code; keep each to one file and the smallest hunk that makes the point:
   ```
   printf -- '--- a/src/walk.ts\n+++ b/src/walk.ts\n@@ -40,0 +42,4 @@\n+  if (!process.stdout.isTTY) return;\n+  split(pane);\n+  render(step);\n+  block();\n' \
     | walk present --title "The new interface" --step 1/4 \
        --note "This makes **live** diff narration possible. Here's the interface a caller uses." \
        --comment "42:this gate short-circuits when there's no TTY"
   ```
   Read what comes back, answer it in chat, then build and present the next step. Repeat until the walk is done.
4. **Finish the walk.** After the last step's reply, call `walk finish "<optional one-line summary>"`. The reviewer shows a completion screen and the pane closes itself; the browser shows an "all steps reviewed" screen. Don't leave a walk dangling on its final step — always finish it so the ending feels deliberate.

Each `present` overwrites the step on stage, and a running reviewer advances to it, so the human always sees the change you're talking about. `--step 1/4` is a cosmetic progress label — the tool doesn't track a real count.

## Render targets

`walk present --render <target>`:

| Target | What happens | When |
|---|---|---|
| `pane` | Splits a pane beside you (herdr or tmux), renders the step, and blocks for a typed comment. **Default inside a multiplexer.** | You're in a herdr or tmux session (the usual case). |
| `web` | Starts the live browser view; the human clicks lines to stage comments, then clicks **Complete step** to send them. Add `--open` to open the browser. | No multiplexer, or the human prefers a browser. |
| `cli` | Prints a rich inline diff to stdout. Does **not** block — the reply is simply the human's next chat message. **Default with no multiplexer.** | You can't open a pane or browser (e.g. running headless inside another tool). |

Other flags: `--no-wait` (present without blocking), `--timeout <sec>` (give up waiting and return control), `--port <n>` (web port, default 4599).

## Getting diffs

`walk present` never fetches — **you** produce a unified diff and pipe it in on stdin. Get it however fits: a local `git`/`gh` command, an API/CLI pull from a repo you never cloned, or one you write by hand for a change that doesn't exist yet. This is what lets you walk a remote PR or a *planned* change, not just local work.

The diff carries its own path in the `---`/`+++` header — there's one input shape and no `--path` flag. The `+47` in `@@ -0,0 +47,3 @@` is what makes the gutter start at line 47 instead of 1; the `---`/`+++` markers say whether the file is added (`--- /dev/null`), deleted (`+++ /dev/null`), or modified (`--- a/x` / `+++ b/x`).

**Build the diff inline; never write a temporary helper script.** It's a one-liner with standard tools, right in the command — don't create a `slice.mjs` / `hunk.sh` scratch file. Pipe a real diff when you have one, or slice a region of a file on disk by adding the header yourself:

```sh
# A real change: let git/gh emit the diff, pipe it straight in.
git diff HEAD -- src/cli.ts | walk present --title "…"

# One file out of a bigger diff.
gh pr diff 17 -R owner/repo | <keep the one file's hunk> | walk present --title "…"

# A region of an existing file as an added block: header + sed, no script.
{ printf '%s\n' '--- /dev/null' '+++ b/src/diff/input.ts' '@@ -0,0 +41,31 @@'; \
  sed -n '41,71p' src/diff/input.ts | sed 's/^/+/'; } | walk present --title "…"
```

Decorate the step with `--title`, `--note "<markdown>"`, `--step <n/total>`, and repeatable `--comment "line:message"` (the message may contain colons). A comment (and a note) may span multiple lines — pass a real newline, e.g. bash `$'42:first line\nsecond line'`; all three targets preserve the breaks. **Show the smallest hunk that makes the point** — one file per step, ~15-20 lines. A good walk is a sequence of small, captioned diffs, not one giant dump.

## Handling replies

`walk present` (and `walk await`) print the reply in a delimited block tagged with its source. Treat it as the human talking to you: answer the question, make the change they asked for, or just acknowledge and continue. If you need to wait again without presenting a new step, `walk await --timeout <sec>`.

## Other commands

- `walk await [--timeout <sec>]` — block for the next reply without presenting a new step.
- `walk reply "<text>"` — record a reply yourself (mostly for tooling/tests).
- `walk finish "<summary>"` — end the walk: completion screen in the reviewer, then the pane closes; the browser shows an all-reviewed screen. Call this after the final step.
- `walk status` — show the walk title and the step currently on stage.
- `walk stop` — force-close the reviewer pane and stop the server (finish is the graceful way to end).

## Shape of a good step: text-first, code-light

**Every step must show code or a concrete example — never prose alone.** A step is narration *plus* the diff that proves it, shown together. Put the context in the step's `--note` (and point at lines with `--comment`). A step with no code on screen reads as empty and confusing — there is nothing for the reader to look at or react to. If you have something to say, attach it to the code it's about. There is no prose-only step; every step is a diff.

**Lead with prose, then show a small diff.** Within a step, open with a paragraph or two of context (`--note`), then roughly **15–20 lines of code** — the specific lines that make the point. The narration frames the walk; the diff is the evidence, and it's always present.

If a step shows more than ~20 lines of code, assume the human will not read all of it, and treat that as a signal to either split the step or narrate what to look for. When a change is genuinely large, say so and point at the two or three lines that matter rather than dumping the whole thing.

Levers for keeping diffs small:
- One file per step is the norm, not the exception.
- You control the hunk you pipe in, so pipe only the lines that matter — author a tight `@@` hunk, or slice a region out of a bigger diff before it reaches `walk present`.
- For a new/large file, show one region per step: a hunk like `@@ -0,0 +47,18 @@` renders just lines 47-64, with the gutter numbered correctly.
- Split a big file across several steps, each narrating one region.

## Style for narration (the `--note` and `--comment` text)

The voice of a senior engineer giving a tour: lead with what the change enables, then point at the specific code. Short paragraphs, markdown welcome (bold, `code`, lists, blockquotes). Don't restate the diff line by line — it's already on screen. Explain the *why* and the non-obvious, and end steps in a way that invites a reaction ("does this hold up for the streaming case?").

## You pace the walk, and you can change it as you go

The reviewer (pane or browser) shows **one step at a time** — the step you last presented. The reader can't skip ahead, so the walk moves at your pace: present a step, read the reaction, then present the next. Advance only when you're ready.

Because the tool holds no backlog, the walk is never frozen — you decide the next step *after* reading the reaction, not before. Respond to what the human says:
- They want less: present a tighter step (a smaller hunk) instead of the one you had in mind.
- They're confused: re-present the same region with a clearer `--note` and a `--comment` on the exact line.
- They ask about something you haven't shown: pipe that diff and present it now, even if it wasn't in your original plan.
- They correct you: acknowledge it, present a follow-up step with the right framing, and move on.

Author each step in the moment, shaped by the conversation so far. A walk is a conversation, not a script you read start to finish.

## Presenting: always call it inline (never in the background)

`walk present` blocks and prints the human's reply to stdout when the wait ends. Run it **inline, in the foreground, for every render target — pane, web, and cli alike.** The reply then comes straight back to you as the command's output. Do not background it (and do not background `walk await`): a backgrounded call writes to a file you then have to go read, which adds a whole extra round-trip for no benefit. Pass `--timeout <sec>` (≤ 600, the Bash tool's ceiling) so a long silence returns control instead of hanging, and just call `present` again to keep waiting.
