# codewalk

A small CLI that lets an LLM (or you) narrate a **guided walk** through a PR, branch, or code change — interleaving prose with rendered inline diffs and per-line comments.

> Walk me through PR #17.

The agent pulls the diff (`gh`, `git`, or raw input), then calls `walk` to build a narrated sequence: a sentence of context, then the exact diff that proves it, then the next point. The result renders as a live, scrollable browser view or as inline terminal text.

## Install

```sh
bun install
bun link          # optional: makes `walk` available globally
```

Without `bun link`, run any command as `bun run src/cli.ts <args>`.

## Quick start

```sh
# 1. Open the live view in its own pane (tmux / Herd / a spare terminal)
walk serve --port 4599        # → http://localhost:4599, updates live

# 2. In another pane, build the walk
walk start "PR #17: streaming diff narration"
walk say "This change makes **live** diff narration possible. Here's the interface:"
walk diff --from main --to HEAD --files src/walk.ts --title "The new interface"
walk comment src/walk.ts 42 "This gate short-circuits when there's no TTY."
```

The browser view updates on every command. No pane? Build the walk, then:

```sh
walk render --format ansi              # inline terminal render
walk render --format html --out walk.html   # self-contained HTML file
```

## Diff sources

```sh
walk diff --pr 17                      # a GitHub PR (via gh)
walk diff --from main --to HEAD        # a git range
walk diff --from HEAD                   # working tree vs HEAD
walk diff --staged                     # staged changes
git show <sha> | walk diff --stdin     # any raw unified diff
walk diff --from main --files src/a.ts src/b.ts   # scope to files
```

Decorate a diff step: `--title`, `--note "<markdown>"`, and repeatable
`--comment "path:line:message"`.

## How it works

- **Parser** (`src/diff/parse.ts`) turns a unified diff into a structured model (files, hunks, per-line old/new numbers, add/delete counts, rename/binary detection).
- **Store** (`src/store.ts`) persists a *walk* — an ordered list of prose and diff steps — as JSON under `.codewalk/`, with a pointer to the active walk.
- **Renderers** produce a GitHub-style HTML view (`src/render/html.ts`, light/dark aware, inline comment rows) and an ANSI/plain terminal view (`src/render/terminal.ts`, auto-disables color off-TTY).
- **Server** (`src/server.ts`) is a Bun HTTP server that serves the view and pushes live updates over SSE by watching `.codewalk/`.

## Commands

| Command | Purpose |
|---|---|
| `start <title>` | Begin a walk (becomes active). |
| `serve [--port]` | Live browser view; leave running in a pane. |
| `say <markdown...>` | Add a narration step. |
| `diff [source] [--title] [--note] [--comment]` | Add a rendered diff step. |
| `comment <path> <line> <msg> [--side old\|new] [--step]` | Inline comment on the latest diff step. |
| `render [--format html\|ansi] [--out]` | Static render. |
| `list` / `walks` / `use <id>` / `status` | Manage walks. |

`.claude/skills`-style usage instructions for agents live in [SKILL.md](./SKILL.md).

## Tests

```sh
bun test          # diff parser coverage
bun run typecheck # tsc --noEmit
```
