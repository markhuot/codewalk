#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { parseUnifiedDiff } from "./diff/parse.ts";
import { resolveDiff } from "./diff/sources.ts";
import {
  addStep,
  createWalk,
  currentId,
  listWalks,
  loadCurrent,
  loadWalk,
  nextStepId,
  saveWalk,
  setCurrent,
} from "./store.ts";
import { renderTerminal } from "./render/terminal.ts";
import { renderStandalone } from "./render/html.ts";
import { serve } from "./server.ts";
import type { Comment, DiffStep } from "./types.ts";

const HELP = `codewalk — narrate a walk through a PR / branch / code change.

Usage: walk <command> [options]

Commands:
  start <title>              Begin a new walk (becomes the active walk).
  serve [--port <n>]         Open the live browser view (run in its own pane).
  say <markdown...>          Add a prose/narration step.
  diff [source] [options]    Add a rendered diff step. Sources:
       --pr <n>                a GitHub PR, via \`gh pr diff\`
       --from <ref> [--to <ref>]  a git range (from..to, or against working tree)
       --staged                staged changes (\`git diff --cached\`)
       --files <a> <b> ...     limit to paths (combine with --from/--staged)
       --stdin                 read a raw unified diff from stdin
     diff options:
       --title <text>          heading shown above the diff
       --note <markdown>       narration shown above the diff
       --comment <path:line:msg>   inline comment (repeatable; :line optional)
  comment <path> <line> <msg>  Attach an inline comment to the latest diff step.
       [--side old|new] [--step <id>]
  render [--format html|ansi|md] [--out <file>]   Print/write a static render.
  list                       List steps in the active walk.
  walks                      List all walks.
  use <id>                   Switch the active walk.
  status                     Show the active walk id and step count.

Examples:
  walk serve --port 4599 &
  walk start "PR #17: streaming diff walk"
  walk say "This change makes **live** diff narration possible."
  walk diff --pr 17 --title "The new public interface" \\
       --comment "src/walk.ts:42:this gate is the interesting part"
  git diff | walk diff --stdin --note "Working-tree changes"
`;

function parseCommentSpec(spec: string): Comment {
  // Format: path:line:message  (message may contain colons)
  const first = spec.indexOf(":");
  const second = spec.indexOf(":", first + 1);
  if (first === -1 || second === -1) {
    throw new Error(`--comment must be "path:line:message", got "${spec}"`);
  }
  const file = spec.slice(0, first);
  const line = parseInt(spec.slice(first + 1, second), 10);
  const body = spec.slice(second + 1);
  if (Number.isNaN(line)) throw new Error(`--comment line must be a number in "${spec}"`);
  return { file, line, side: "new", body };
}

function latestDiffStep(walkId?: string): { walk: ReturnType<typeof loadCurrent>; step: DiffStep } {
  const walk = walkId ? loadWalk(walkId) : loadCurrent();
  for (let i = walk.steps.length - 1; i >= 0; i--) {
    const s = walk.steps[i]!;
    if (s.kind === "diff") return { walk, step: s };
  }
  throw new Error("No diff step to attach a comment to. Add one with `walk diff ...`.");
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
      const walk = createWalk(title);
      console.log(`Started walk ${walk.id}: ${walk.title}`);
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
      console.log("Leave this running; diff/say/comment commands update it live. Ctrl-C to stop.");
      const shutdown = () => {
        s.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      await new Promise(() => {}); // run until killed
      return;
    }

    case "say": {
      const text = rest.join(" ").trim();
      if (!text) throw new Error("say needs text: walk say \"...\"");
      const walk = loadCurrent();
      addStep({ kind: "prose", id: nextStepId(walk, "prose"), text });
      console.log("Added prose step.");
      return;
    }

    case "diff": {
      const { values } = parseArgs({
        args: rest,
        options: {
          pr: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          staged: { type: "boolean", default: false },
          stdin: { type: "boolean", default: false },
          files: { type: "string", multiple: true },
          title: { type: "string" },
          note: { type: "string" },
          comment: { type: "string", multiple: true },
        },
        allowPositionals: true,
      });

      const raw = await resolveDiff({
        pr: values.pr as string | undefined,
        from: values.from as string | undefined,
        to: values.to as string | undefined,
        staged: values.staged as boolean,
        stdin: values.stdin as boolean,
        files: values.files as string[] | undefined,
      });

      const files = parseUnifiedDiff(raw);
      if (files.length === 0) {
        throw new Error("No changes found for that diff source.");
      }
      const comments = ((values.comment as string[] | undefined) ?? []).map(parseCommentSpec);
      const walk = loadCurrent();
      const step: DiffStep = {
        kind: "diff",
        id: nextStepId(walk, "diff"),
        title: values.title as string | undefined,
        note: values.note as string | undefined,
        files,
        comments,
      };
      addStep(step);
      const totalAdd = files.reduce((n, f) => n + f.additions, 0);
      const totalDel = files.reduce((n, f) => n + f.deletions, 0);
      console.log(`Added diff step ${step.id}: ${files.length} file(s), +${totalAdd} -${totalDel}.`);
      return;
    }

    case "comment": {
      const { values, positionals } = parseArgs({
        args: rest,
        options: {
          side: { type: "string", default: "new" },
          step: { type: "string" },
        },
        allowPositionals: true,
      });
      const [file, lineStr, ...msg] = positionals;
      const body = msg.join(" ");
      if (!file || !lineStr || !body) {
        throw new Error('comment needs: walk comment <path> <line> "<message>"');
      }
      const side = values.side === "old" ? "old" : "new";
      const { walk, step } = latestDiffStep(values.step as string | undefined);
      step.comments.push({ file, line: parseInt(lineStr, 10), side, body });
      saveWalk(walk);
      console.log(`Added comment on ${file}:${lineStr} (${side}) to step ${step.id}.`);
      return;
    }

    case "render": {
      const { values } = parseArgs({
        args: rest,
        options: {
          format: { type: "string", default: "ansi" },
          out: { type: "string" },
        },
        allowPositionals: true,
      });
      const walk = loadCurrent();
      let output: string;
      if (values.format === "html") output = renderStandalone(walk);
      else output = renderTerminal(walk); // ansi/md both go through the text renderer
      if (values.out) {
        await Bun.write(values.out as string, output);
        console.log(`Wrote ${values.out}`);
      } else {
        process.stdout.write(output + "\n");
      }
      return;
    }

    case "list": {
      const walk = loadCurrent();
      console.log(`${walk.title} (${walk.id})`);
      walk.steps.forEach((s, i) => {
        if (s.kind === "prose") console.log(`  ${i + 1}. [prose] ${s.text.slice(0, 60)}`);
        else console.log(`  ${i + 1}. [diff:${s.id}] ${s.title ?? `${s.files.length} file(s)`} (${s.comments.length} comment(s))`);
      });
      return;
    }

    case "walks": {
      const walks = listWalks();
      const active = currentId();
      if (walks.length === 0) console.log("No walks yet.");
      for (const w of walks) {
        console.log(`${w.id === active ? "*" : " "} ${w.id}  ${w.steps} step(s)  ${w.title}`);
      }
      return;
    }

    case "use": {
      const id = rest[0];
      if (!id) throw new Error("use needs a walk id");
      loadWalk(id); // validates existence
      setCurrent(id);
      console.log(`Active walk → ${id}`);
      return;
    }

    case "status": {
      const id = currentId();
      if (!id) {
        console.log("No active walk.");
        return;
      }
      const walk = loadWalk(id);
      console.log(`Active: ${walk.id}\nTitle:  ${walk.title}\nSteps:  ${walk.steps.length}`);
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
