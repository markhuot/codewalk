import type { Comment, DiffFile, Reply, Step } from "../types.ts";
import { highlightLine, langFor } from "./highlight.ts";
import { bandColors } from "./theme.ts";

// ANSI helpers. Color is on when stdout is a TTY, or forced via FORCE_COLOR /
// CODEWALK_COLOR (the reviewer pane sets this so a spawned process still gets
// color). NO_COLOR always wins for clean piped/inline output.
const useColor =
  !process.env.NO_COLOR &&
  (process.stdout.isTTY === true || process.env.FORCE_COLOR === "1" || process.env.CODEWALK_COLOR === "1");

const sgr = (open: string, s: string) => (useColor ? `\x1b[${open}m${s}\x1b[0m` : s);
const dim = (s: string) => sgr("2", s);
const bold = (s: string) => sgr("1", s);
const italic = (s: string) => sgr("3", s);
const green = (s: string) => sgr("32", s);
const red = (s: string) => sgr("31", s);
const cyan = (s: string) => sgr("36", s);
const yellow = (s: string) => sgr("33", s);
const blue = (s: string) => sgr("34", s);

// Truecolor line fills (theme-aware). Syntax colors sit on top of the background
// band (they only touch the foreground), and the marker keeps its own tint.
const RESET = "\x1b[0m";

/** A code line laid over a background band, with a tinted marker and highlighted body. */
function band(bg: string, mark: string, marker: string, body: string, lang: string | undefined): string {
  if (!useColor) return `${marker} ${body}`;
  return `${bg}${mark}${marker} ${RESET}${bg}${highlightLine(body, lang)}${RESET}`;
}

function commentsFor(comments: Comment[], side: "old" | "new", line?: number): Comment[] {
  if (line == null) return [];
  return comments.filter((x) => x.side === side && x.line === line);
}

function statusTag(status: DiffFile["status"]): string {
  const tag = { added: "[+]", deleted: "[-]", modified: "[~]", renamed: "[»]" }[status];
  const paint = { added: green, deleted: red, modified: yellow, renamed: blue }[status];
  return paint(tag);
}

/** Very small markdown flattener for prose in a terminal (bold/code/headings). */
function proseToTerminal(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      let s = line;
      s = s.replace(/^#{1,6}\s+(.*)$/, (_, t) => bold(t));
      s = s.replace(/^>\s?(.*)$/, (_, t) => dim("│ ") + italic(t));
      s = s.replace(/^\s*[-*]\s+(.*)$/, (_, t) => dim("  • ") + t);
      s = s.replace(/\*\*(.+?)\*\*/g, (_, t) => bold(t));
      s = s.replace(/`([^`]+)`/g, (_, t) => cyan(t));
      return s;
    })
    .join("\n");
}

/** Trim a raw (un-colored) string so gutter + content fit one row. */
function clip(content: string, budget: number): string {
  if (budget <= 1 || content.length <= budget) return content;
  return content.slice(0, Math.max(1, budget - 1)) + "…";
}

function renderFile(file: DiffFile, comments: Comment[], width: number): string {
  const out: string[] = [];
  const path = file.status === "renamed" ? `${file.oldPath} → ${file.newPath}` : file.newPath || file.oldPath;
  const stat = dim("+") + green(String(file.additions)) + dim(" −") + red(String(file.deletions));
  out.push(`${statusTag(file.status)} ${bold(path)}  ${stat}`);
  if (file.binary) {
    out.push(dim("    (binary file)"));
    return out.join("\n");
  }
  // A narrow pane can't fit the dual old/new gutter; drop to a single column.
  const wide = width >= 64;
  const gutterCols = wide ? 11 : 6; // "OOOO NNNN " vs "NNNN "
  const contentBudget = Math.max(12, width - gutterCols - 2); // 2 = marker + space
  const lang = langFor(file.newPath || file.oldPath);
  const bc = bandColors();

  const fileComments = comments.filter((x) => x.file === file.newPath || x.file === file.oldPath);
  for (const hunk of file.hunks) {
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    out.push(cyan(clip(header + (hunk.section ? " " + hunk.section : ""), width)));
    for (const l of hunk.lines) {
      const oldN = String(l.oldNumber ?? "").padStart(4, " ");
      const newN = String(l.newNumber ?? "").padStart(4, " ");
      const gutter = dim(wide ? `${oldN} ${newN} ` : `${newN} `);
      const body = clip(l.content, contentBudget);
      if (l.type === "add") out.push(gutter + band(bc.addBg, bc.addMark, "+", body, lang));
      else if (l.type === "del") out.push(gutter + band(bc.delBg, bc.delMark, "-", body, lang));
      else out.push(gutter + dim("  ") + (useColor ? highlightLine(body, lang) : body));
      for (const cm of commentsFor(fileComments, "old", l.oldNumber)) out.push(renderComment(cm, width));
      for (const cm of commentsFor(fileComments, "new", l.newNumber)) out.push(renderComment(cm, width));
    }
  }
  return out.join("\n");
}

function renderComment(cm: Comment, width: number): string {
  const bar = yellow("│");
  const anchor = dim(`${cm.file}:${cm.line}`);
  const budget = Math.max(20, width - 13);
  // Preserve the comment's own line breaks, wrapping each line to width.
  const lines = cm.body.split("\n").flatMap((line) => wrap(line, budget)).map((l) => `           ${bar} ${l}`);
  return `           ${bar} ${anchor}\n${lines.join("\n")}`;
}

/** Wrap text to a width, breaking on spaces where possible. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function termWidth(explicit?: number): number {
  return explicit ?? (process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 100);
}

/** Render one step as a self-contained block. */
export function renderStep(step: Step, opts: { width?: number } = {}): string {
  const width = termWidth(opts.width);
  const out: string[] = [];
  if (step.title) out.push(bold(step.title));
  if (step.note) out.push(proseToTerminal(step.note));
  if (step.title || step.note) out.push("");
  for (const f of step.files) out.push(renderFile(f, step.comments, width));
  return out.join("\n");
}

/** Render the back-and-forth replies attached to a step. */
export function renderThread(replies: Reply[]): string {
  if (replies.length === 0) return "";
  const out: string[] = [];
  for (const r of replies) {
    const who = r.source === "web" ? "you (browser)" : r.source === "pane" ? "you" : "you (cli)";
    out.push(green(`  ┌ ${who}`));
    for (const line of r.text.split("\n")) out.push(green("  │ ") + line);
    out.push(green("  └"));
  }
  return out.join("\n");
}
