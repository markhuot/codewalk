#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { parseUnifiedDiff } from "./diff/parse.ts";
import { readStdin, requireUnifiedDiff } from "./diff/input.ts";
import {
  awaitReply,
  clearServerInfo,
  createSession,
  getPaneId,
  getServerInfo,
  getSession,
  setFinished,
  setStep,
  writeReply,
} from "./store.ts";
import { renderStep } from "./render/terminal.ts";
import { serve } from "./server.ts";
import { present, type RenderTarget } from "./present.ts";
import { runReviewer } from "./pane.ts";
import { activeDriver } from "./panes/index.ts";
import type { Comment, DiffStep, Reply } from "./types.ts";

const HELP = `codewalk — a narrated, back-and-forth walk through a PR / branch / code change.

Usage: walk <command> [options]

The loop:
  start <title>              Begin a walk (one active session; no stored backlog).
  present [options]          Build ONE step from the diff piped on stdin, put it
       on stage, and BLOCK until the human replies (reply printed to stdout so it
       flows back into the conversation). Author the next step and present again —
       the tool holds only the step on stage, so you advance live. Pipe a unified
       diff (it carries its own path in the ---/+++ header; no --path flag).
       --title <text>          heading shown above the diff
       --note <markdown>       narration shown above the diff
       --comment <line:msg>    inline comment on a line (repeatable)
       --step <n/total>        cosmetic progress label shown in the reviewer (e.g. 1/4)
       --render pane|web|cli   reviewer target (default: pane inside herdr, else cli)
       --no-wait               present without blocking
       --timeout <sec>         give up waiting and return control
       --port <n> / --open     web target: port (default 4599) / open a browser
  await [--timeout <sec>]     Block for the next reply without presenting.
  finish [<summary>]          End the walk: the pane shows "complete" then closes,
                              the browser shows an all-reviewed screen.

Manage:
  serve [--port <n>]         Run the live browser view (used by --render web).
  reply <text...> [--step]   Record a reply yourself (mostly for tooling/tests).
  pane                       Run the interactive reviewer (used inside a pane).
  status                     Show the title and the step on stage.
  stop                       Close the reviewer pane and stop the server.

Examples:
  walk start "PR #17: streaming diff walk"
  gh pr diff 17 -R owner/repo | extract-one-file \\
    | walk present --title "The new interface" --step 1/4
  # → read the reply, build the next step, present again
  git diff HEAD -- src/walk.ts | walk present --render web --open   # same loop, in the browser
`;

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);
const boldGreen = (s: string) => (useColor ? `\x1b[1;32m${s}\x1b[0m` : s);

/**
 * Print a reply in a clearly delimited block. This is what the agent reads back
 * as the result of a blocking `present`/`await`, so it must stand out from the
 * surrounding tool chatter.
 */
function printReply(reply: Reply): void {
  const on = reply.stepId ? ` on ${reply.stepId}` : "";
  console.log("");
  console.log(boldGreen(`╭─ reply from ${reply.source}${on} ` + "─".repeat(Math.max(0, 40 - reply.source.length))));
  if (reply.text) for (const line of reply.text.split("\n")) console.log(boldGreen("│ ") + line);
  const comments = reply.comments ?? (reply.anchor ? [{ ...reply.anchor, text: reply.text }] : []);
  for (const c of comments) {
    const range = c.endLine && c.endLine > c.line ? `–${c.endLine}` : "";
    console.log(boldGreen("│ ") + dim(`${c.file}:${c.line}${range}`) + `  ${c.text}`);
  }
  console.log(boldGreen("╰" + "─".repeat(52)));
  console.log("");
}

/** Parse a repeatable `--comment "line:message"` value (the message may contain colons). */
function parseCommentSpec(spec: string): { line: number; body: string } {
  const idx = spec.indexOf(":");
  if (idx === -1) {
    throw new Error(`--comment must be "line:message", got "${spec}"`);
  }
  const line = parseInt(spec.slice(0, idx), 10);
  const body = spec.slice(idx + 1);
  if (Number.isNaN(line)) throw new Error(`--comment line must be a number in "${spec}"`);
  return { line, body };
}

async function main() {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return;

    case "start": {
      const title = rest.join(" ").trim();
      if (!title) throw new Error('start needs a title: walk start "PR #17: ..."');
      const session = createSession(title);
      console.log(`Started walk: ${session.title}`);
      return;
    }

    case "serve": {
      const { values } = parseArgs({
        args: rest,
        options: { port: { type: "string", default: "4599" } },
        allowPositionals: true,
      });
      const port = parseInt(values.port as string, 10);
      const s = serve(port);
      const url = `http://localhost:${s.port}`;
      console.log(`codewalk live view → ${url}`);
      console.log("Leave this running; each `walk present` updates it live. Ctrl-C to stop.");
      const shutdown = () => {
        s.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      await new Promise(() => {}); // run until killed
      return;
    }

    case "present": {
      const { values } = parseArgs({
        args: rest,
        options: {
          title: { type: "string" },
          note: { type: "string" },
          comment: { type: "string", multiple: true },
          step: { type: "string" },
          render: { type: "string" },
          wait: { type: "boolean", default: true },
          "no-wait": { type: "boolean", default: false },
          timeout: { type: "string" },
          port: { type: "string", default: "4599" },
          open: { type: "boolean", default: false },
        },
        allowPositionals: true,
      });

      // Build the one step from the piped diff, then stage it. There's no stored
      // backlog: this overwrites whatever step was on stage.
      if (process.stdin.isTTY) {
        throw new Error(
          "Pipe a unified diff on stdin, e.g.  git diff HEAD -- src/foo.ts | walk present",
        );
      }
      const raw = requireUnifiedDiff(await readStdin());
      const files = parseUnifiedDiff(raw);
      if (files.length === 0) {
        throw new Error("No changes found — is the diff body a valid unified diff?");
      }
      // Comments anchor to the step's file by the path in the diff header.
      const label = files[0]!.newPath || files[0]!.oldPath || "";
      const comments: Comment[] = ((values.comment as string[] | undefined) ?? [])
        .map(parseCommentSpec)
        .map((c) => ({ file: label, line: c.line, side: "new", body: c.body }));
      const step: DiffStep = {
        kind: "diff",
        title: values.title as string | undefined,
        note: values.note as string | undefined,
        progress: (values.step as string | undefined)?.trim() || undefined,
        files,
        comments,
      };
      setStep(step);

      const raw2 = (values.render as string | undefined) ?? (activeDriver() ? "pane" : "cli");
      const render: RenderTarget = raw2 === "webpage" ? "web" : (raw2 as RenderTarget);
      if (!["cli", "pane", "web"].includes(render)) {
        throw new Error(`--render must be pane, web, or cli (got "${raw2}")`);
      }
      const wait = (values["no-wait"] as boolean) ? false : (values.wait as boolean);
      const timeoutSec = values.timeout ? parseInt(values.timeout as string, 10) : undefined;

      const result = await present({
        render,
        wait,
        timeoutSec,
        port: parseInt(values.port as string, 10),
        open: values.open as boolean,
      });

      if (result.note) {
        console.log(result.note);
        return;
      }

      if (render === "cli" && result.step) {
        process.stdout.write("\n" + renderStep(result.step) + "\n");
        console.log(`\n${dim("— rendered inline. The user's reply is their next message.")}`);
        return;
      }

      const where = render === "pane" ? "reviewer pane" : "browser";
      if (!wait) {
        console.log(`Presented step to the ${where}. (not waiting for a reply)`);
        return;
      }
      if (result.reply) {
        printReply(result.reply);
      } else {
        console.log(`No reply within the timeout. Run \`walk await\` to keep waiting, or check the ${where}.`);
      }
      return;
    }

    case "await": {
      const { values } = parseArgs({
        args: rest,
        options: { timeout: { type: "string" } },
        allowPositionals: true,
      });
      const timeoutSec = values.timeout ? parseInt(values.timeout as string, 10) : undefined;
      const reply = await awaitReply(timeoutSec != null ? timeoutSec * 1000 : undefined);
      if (reply) printReply(reply);
      else console.log("No reply within the timeout.");
      return;
    }

    case "reply": {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { step: { type: "string" } },
        allowPositionals: true,
      });
      const text = positionals.join(" ").trim();
      if (!text) throw new Error('reply needs text: walk reply "..."');
      const r = writeReply(text, { stepId: (values.step as string | undefined) ?? null, source: "cli" });
      console.log(`Recorded reply ${r.id}.`);
      return;
    }

    case "finish": {
      const summary = rest.join(" ").trim();
      setFinished(summary || undefined);
      // The reviewer shows a completion screen and closes its own pane; the
      // browser shows an "all steps reviewed" screen via SSE.
      console.log("Walk finished — completion shown to the reviewer.");
      return;
    }

    case "pane": {
      await runReviewer(); // runs until the pane closes or Ctrl-C
      return;
    }

    case "stop": {
      const paneId = getPaneId();
      if (paneId) {
        try {
          activeDriver()?.close(paneId);
        } catch {
          /* pane may already be gone */
        }
      }
      const info = getServerInfo();
      if (info?.pid) {
        try {
          process.kill(info.pid);
        } catch {
          /* already stopped */
        }
      }
      clearServerInfo();
      console.log("Closed reviewer pane and stopped the server (if running).");
      return;
    }

    case "status": {
      const session = getSession();
      if (!session) {
        console.log("No active walk.");
        return;
      }
      const step = session.step;
      const onStage = step
        ? `${step.progress ? step.progress + " — " : ""}${step.title ?? `${step.files.length} file(s)`}`
        : "(nothing on stage yet)";
      console.log(`Title:    ${session.title}\nOn stage: ${onStage}`);
      return;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
