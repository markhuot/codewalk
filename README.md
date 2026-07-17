# codewalk

A small CLI that lets an LLM (or you) walk a human through a PR, branch, or code change as a **back-and-forth conversation** — interleaving prose with rendered inline diffs and per-line comments, then blocking for the human's reply and responding to it.

> Walk me through PR #17.

The agent pulls the diff (`gh`, `git`, or raw input), builds a narrated sequence (a sentence of context, then the exact diff that proves it), puts one change on stage, and **waits**. The human comments in a herdr pane or the browser, that comment flows back to the agent, and the walk continues one change at a time.

## Install

Run it with no install via npx (needs Node ≥ 18):

```sh
npx @markhuot/codewalk present
```

Or install it globally:

```sh
npm i -g @markhuot/codewalk
codewalk present        # `walk` is aliased too
```

You supply the diff (codewalk doesn't shell out to `git` or `gh`). For the `--render pane` reviewer you need [herdr](https://herdr.dev) or tmux; otherwise use `--render web` or `--render cli`.

### From source (development)

```sh
bun install
bun run src/cli.ts <args>   # or: bun run walk <args>
bun run build              # bundle to dist/cli.js (Node target)
```

## The loop

```sh
walk start "PR #17: streaming diff narration"
gh pr diff 17 | pick-the-file-you-want | walk present --path src/walk.ts \
     --title "The new interface" \
     --note "This makes **live** diff narration possible." \
     --comment "42:this gate short-circuits when there's no TTY" \
     --step 1/4
# → read the reply printed to stdout, build the next step, present again
```

`walk present` is the whole loop. One call builds a step from the diff you pipe in, puts it on stage, and blocks until the human replies; the reply prints to stdout so it flows straight back into the agent's conversation. There's no stored backlog — the tool holds only the step on stage, so the agent authors and presents one live step at a time.

## Render targets

`walk present --render <target>`:

- **`pane`** (default inside a multiplexer) — splits a pane beside you and blocks for a typed comment. Works in [herdr](https://herdr.dev) and tmux via pluggable pane drivers (`src/panes/`).
- **`web`** — a live browser view: click any line to stage a comment, then **Complete step** to send them together. Add `--open` to open it.
- **`cli`** — a rich inline diff printed to the terminal; the reply is just the human's next message (no blocking).

The reviewer is turn-based: comment on the change on screen, and it advances when the agent presents the next step.

## The diff you pipe in

`walk present` doesn't fetch anything — you hand it the diff on stdin and it renders it. That keeps codewalk out of the diff-acquisition business: you get the hunk however you like (a local `git`/`gh` command, an API pull from a repo you never cloned, or a hunk you author by hand for a change that doesn't exist yet) and pipe it in.

```sh
# The common case: a bare unified hunk. The file envelope is synthesized from
# --path, and a real `@@ -0,0 +47,3 @@` renders with the right gutter numbers.
printf '@@ -0,0 +47,3 @@\n+const a = 1;\n+const b = 2;\n+const c = 3;\n' \
  | walk present --path src/foo.ts --title "The new interface"

# Pull one file out of a remote PR you never cloned and narrate it.
gh pr diff 17 -R owner/repo | extract-one-file | walk present --path src/walk.ts

# A full `diff --git` is used as-is (the path comes from the diff itself).
git show <sha> -- src/a.ts | walk present
```

`--path` is a label, not a file on disk. Decorate the step: `--title`, `--note "<markdown>"`, `--step 1/4` (a cosmetic progress label), and comments — repeat `--comment "line:message"`, or use `--comment:<line> "message"` (append `:old` for the old side).

## How it works

- **Parser** (`src/diff/parse.ts`) turns a unified diff into a structured model (files, hunks, per-line old/new numbers, add/delete counts, rename/binary detection).
- **Store** (`src/store.ts`) persists the active *session* — its one on-stage step — as JSON under `.codewalk/`, plus a **reply inbox**, a reply cursor, and a **focus sequence** that bumps on every present. There's no stored step history; presenting overwrites the step.
- **The reply inbox** is the spine of the conversation. Every render target — pane, browser, cli — writes the human's comments into `.codewalk/replies/`, and a blocking `walk await` returns the next unconsumed one. That's how a comment from any surface flows back into the agent's turn.
- **Pane drivers** (`src/panes/`) abstract the terminal multiplexer behind a `PaneDriver` interface (split, run, read, close). herdr and tmux ship today; adding another (cmux, kitty, wezterm) is one file plus a registry entry. `activeDriver()` picks by environment.
- **Reviewer** (`src/pane.ts`) is the interactive terminal UI that runs inside a pane: it renders the step on stage, prompts for a comment, and waits for the agent to advance.
- **Server** (`src/server.ts`) serves the browser view, pushes live updates over SSE, and accepts replies at `POST /api/reply`.
- **Renderers** produce a GitHub-style HTML view (`src/render/html.ts`, light/dark aware, inline comments, reply threads, composer) and a width-aware ANSI/plain terminal view (`src/render/terminal.ts`).

## Commands

| Command | Purpose |
|---|---|
| `start <title>` | Begin a walk (one active session). |
| `present --path <label> [--title] [--note] [--comment] [--step] [--render] [--no-wait] [--timeout] [--port] [--open]` | Build one step from the piped diff, stage it, and block for a reply. |
| `await [--timeout]` | Block for the next reply without presenting. |
| `finish [<summary>]` | End the walk: completion screen, then the pane closes. |
| `reply <text...> [--step]` | Record a reply (tooling/tests). |
| `pane` | Run the interactive reviewer (used inside a pane). |
| `serve [--port]` | Live browser view (used by `--render web`). |
| `status` / `stop` | Show the step on stage / tear down the reviewer. |

Agent usage instructions live in [SKILL.md](./SKILL.md).

## Tests

```sh
bun test          # diff parser + reply inbox / focus coverage
bun run typecheck # tsc --noEmit
```
