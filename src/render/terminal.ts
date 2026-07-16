import type { Comment, DiffFile, Walk } from "../types.ts";

// ANSI helpers. Auto-disable when not writing to a TTY (piped/inline usage) or
// when NO_COLOR is set, so embedded output stays clean plain text.
const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s: string) => c("2", s);
const bold = (s: string) => c("1", s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const cyan = (s: string) => c("36", s);

function commentsFor(comments: Comment[], side: "old" | "new", line?: number): Comment[] {
  if (line == null) return [];
  return comments.filter((x) => x.side === side && x.line === line);
}

function renderFile(file: DiffFile, comments: Comment[]): string {
  const out: string[] = [];
  const path = file.status === "renamed" ? `${file.oldPath} → ${file.newPath}` : file.newPath || file.oldPath;
  out.push(bold(`${statusTag(file.status)} ${path}`) + dim(`  +${file.additions} -${file.deletions}`));
  if (file.binary) {
    out.push(dim("  (binary file)"));
    return out.join("\n");
  }
  const fileComments = comments.filter((x) => x.file === file.newPath || x.file === file.oldPath);
  for (const hunk of file.hunks) {
    out.push(cyan(`  @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.section}`));
    for (const l of hunk.lines) {
      const num = String(l.newNumber ?? l.oldNumber ?? "").padStart(4, " ");
      if (l.type === "add") out.push(green(`  ${num} + ${l.content}`));
      else if (l.type === "del") out.push(red(`  ${num} - ${l.content}`));
      else out.push(dim(`  ${num}   `) + l.content);
      for (const cm of commentsFor(fileComments, "old", l.oldNumber)) out.push(comment(cm));
      for (const cm of commentsFor(fileComments, "new", l.newNumber)) out.push(comment(cm));
    }
  }
  return out.join("\n");
}

function comment(cm: Comment): string {
  return c("33", `        » ${cm.body}`);
}

function statusTag(status: DiffFile["status"]): string {
  return { added: "[A]", deleted: "[D]", modified: "[M]", renamed: "[R]" }[status];
}

/** Render a whole walk as plain (optionally ANSI-colored) terminal text. */
export function renderTerminal(walk: Walk): string {
  const out: string[] = [];
  out.push(bold(`\n${walk.title}\n${"─".repeat(Math.min(walk.title.length, 60))}`));
  for (const step of walk.steps) {
    out.push("");
    if (step.kind === "prose") {
      out.push(step.text);
    } else {
      if (step.title) out.push(bold(step.title));
      if (step.note) out.push(dim(step.note));
      for (const f of step.files) out.push(renderFile(f, step.comments));
    }
  }
  out.push("");
  return out.join("\n");
}
