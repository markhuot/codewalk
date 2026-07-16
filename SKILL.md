---
name: codewalk
description: Narrate a guided "walk" through a PR, branch, or code change with rendered inline diffs and per-line comments. Use when the user asks to be walked through / shown / explained a PR, branch, feature, or set of changes (e.g. "walk me through PR #17", "show me what changed on this branch", "explain this feature"). Builds a live browser view or an inline terminal render.
---

# codewalk

`codewalk` turns a raw diff into a narrated walkthrough. You interleave prose ("this change makes X possible") with rendered diffs of the specific files or hunks that matter, and drop inline comments on the interesting lines. Output goes to a live browser view (rich, scrollable, clickable) or to inline terminal text.

## The command

The binary is `walk`. During development run it as `bun run <repo>/src/cli.ts <args>`, or after `bun link` just `walk <args>`. All examples below use `walk`.

State lives in `.codewalk/` in the current directory. There is one *active walk* at a time; commands append to it.

## Choosing an output mode

- **Its own pane (preferred, rich).** Start `walk serve` in a separate tmux/Herd/terminal pane. It opens a live view at `http://localhost:4599` that updates automatically as you add steps. This supports scroll and click. Open the URL in the user's browser.
- **Inline (no TTY).** If you cannot open a pane, build the walk, then run `walk render --format ansi` and show the output in your reply. Color auto-disables when not attached to a TTY, so it stays clean. Or `walk render --format html --out walk.html` to hand the user a self-contained file.

## Workflow

1. **Get oriented.** Read the PR/branch first so your narration is accurate. `gh pr view <n>`, `gh pr diff <n>`, `git log`, `git diff main...HEAD`. Understand *why* the change exists before narrating.
2. **Start the walk and (ideally) the live view:**
   ```
   walk serve --port 4599 &          # in its own pane; open the printed URL
   walk start "PR #17: streaming diff narration"
   ```
3. **Narrate + show, alternating.** Lead with the point, then show the evidence:
   ```
   walk say "This change makes **live** diff narration possible. Here's the new public interface a caller uses:"
   walk diff --from main --to HEAD --files src/walk.ts --title "The new interface"
   walk say "It's primarily achieved by this SDK addition:"
   walk diff --pr 17 --files src/sdk.ts
   ```
4. **Comment the interesting lines** (inline, GitHub-style):
   ```
   walk comment src/walk.ts 42 "This gate is the interesting part — it short-circuits when TTY is absent."
   ```
   `--side old` anchors to the pre-change line number; default is the new side.

## Getting diffs

`walk diff` accepts one source:

| Source | Flag | Notes |
|---|---|---|
| GitHub PR | `--pr <n>` | uses `gh pr diff <n>` |
| git range | `--from <ref> [--to <ref>]` | `from..to`; omit `--to` to diff against the working tree |
| staged | `--staged` | `git diff --cached` |
| raw stdin | `--stdin` | pipe any unified diff: `git show <sha> \| walk diff --stdin` |
| limit paths | `--files a b ...` | combine with `--from`/`--staged` to scope to specific files |

Diff-step decoration: `--title "<heading>"`, `--note "<markdown shown above the diff>"`, and repeatable `--comment "path:line:message"` for inline comments in one shot.

**Show the smallest diff that makes the point.** Prefer `--files` to focus on one or two files per step rather than dumping the whole PR. A good walk is a sequence of small, captioned diffs, not one giant one.

## Other commands

- `walk list` — steps in the active walk.
- `walk walks` — all walks (active marked with `*`).
- `walk use <id>` — switch active walk.
- `walk status` — active walk + step count.
- `walk render [--format html|ansi] [--out <file>]` — static render.

## Style for narration (the `say` text)

Keep it the voice of a senior engineer giving a tour: lead with what the change enables, then point at the specific code. Short paragraphs. Markdown works (bold, `code`, lists, blockquotes). Don't restate the diff line-by-line — the diff is already on screen; explain the *why* and the *non-obvious*.
