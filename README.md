# codewalk

A small CLI that lets an LLM (or you) walk a human through a PR, branch, or code change as a **back-and-forth conversation** — interleaving prose with rendered inline diffs and per-line comments, then blocking for the human's reply and responding to it.

> Walk me through PR #17.

The agent pulls the diff (`gh`, `git`, or raw input), builds a narrated sequence (a sentence of context, then the exact diff that proves it), puts one change on stage, and **waits**. The human comments in a herdr pane or the browser, that comment flows back to the agent, and the walk continues one change at a time.

## Install

```sh
bun install
bun link          # optional: makes `walk` available globally
```

Without `bun link`, run any command as `bun run src/cli.ts <args>`.

## The loop

```sh
walk start "PR #17: streaming diff narration"
walk say "This makes **live** diff narration possible. Here's the interface:"
walk diff --pr 17 --files src/walk.ts --title "The new interface"
walk present          # opens a reviewer pane, blocks, prints the human's reply
# → read the reply, respond, build the next step, present again
```

`walk present` is the heart of it. It puts the latest step on stage and blocks until the human replies; the reply is printed to stdout so it flows straight back into the agent's conversation.

## Render targets

`walk present --render <target>`:

- **`pane`** (default inside a multiplexer) — splits a pane beside you and blocks for a typed comment. Works in [herdr](https://herdr.dev) and tmux via pluggable pane drivers (`src/panes/`).
- **`web`** — a live browser view with a "Send to Claude" composer. Add `--open` to open it.
- **`cli`** — a rich inline diff printed to the terminal; the reply is just the human's next message (no blocking).

The reviewer is turn-based: comment on the change on screen, and it advances when the agent presents the next step.

## Diff sources

```sh
walk diff --pr 17                      # a GitHub PR (via gh)
walk diff --from main --to HEAD        # a git range
walk diff --from HEAD                   # working tree vs HEAD (untracked files included)
walk diff --staged                     # staged changes
git show <sha> | walk diff --stdin     # any raw unified diff
walk diff --from main --files src/a.ts src/b.ts   # scope to files
```

Decorate a diff step: `--title`, `--note "<markdown>"`, and repeatable `--comment "path:line:message"`.

## How it works

- **Parser** (`src/diff/parse.ts`) turns a unified diff into a structured model (files, hunks, per-line old/new numbers, add/delete counts, rename/binary detection).
- **Store** (`src/store.ts`) persists a *walk* as JSON under `.codewalk/`, plus a **reply inbox**, a reply cursor, and a **focus pointer** whose sequence bumps on every present.
- **The reply inbox** is the spine of the conversation. Every render target — pane, browser, cli — writes the human's comments into `.codewalk/replies/`, and a blocking `walk await` returns the next unconsumed one. That's how a comment from any surface flows back into the agent's turn.
- **Pane drivers** (`src/panes/`) abstract the terminal multiplexer behind a `PaneDriver` interface (split, run, read, close). herdr and tmux ship today; adding another (cmux, kitty, wezterm) is one file plus a registry entry. `activeDriver()` picks by environment.
- **Reviewer** (`src/pane.ts`) is the interactive terminal UI that runs inside a pane: it renders the focused step, prompts for a comment, and waits for the agent to advance.
- **Server** (`src/server.ts`) serves the browser view, pushes live updates over SSE, and accepts replies at `POST /api/reply`.
- **Renderers** produce a GitHub-style HTML view (`src/render/html.ts`, light/dark aware, inline comments, reply threads, composer) and a width-aware ANSI/plain terminal view (`src/render/terminal.ts`).

## Commands

| Command | Purpose |
|---|---|
| `start <title>` | Begin a walk (becomes active). |
| `say <markdown...>` | Add a narration step. |
| `diff [source] [--title] [--note] [--comment]` | Add a rendered diff step. |
| `comment <path> <line> <msg> [--side old\|new] [--step]` | Inline comment on a diff step. |
| `present [--render pane\|web\|cli] [--step] [--no-wait] [--timeout] [--port] [--open]` | Put a step on stage and block for a reply. |
| `await [--timeout]` | Block for the next reply without presenting. |
| `reply <text...> [--step]` | Record a reply (tooling/tests). |
| `pane` | Run the interactive reviewer (used inside a pane). |
| `serve [--port]` | Live browser view (used by `--render web`). |
| `render [--format html\|ansi] [--out]` | Static render. |
| `list` / `walks` / `use <id>` / `status` / `stop` | Manage walks and tear down. |

Agent usage instructions live in [SKILL.md](./SKILL.md).

## Tests

```sh
bun test          # diff parser + reply inbox / focus coverage
bun run typecheck # tsc --noEmit
```
