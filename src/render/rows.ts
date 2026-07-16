// Builds the scrollable content of the reviewer TUI as an array of rows. Each
// row is a fully-rendered (ANSI) line; diff code rows also carry a LineAnchor so
// a mouse click can map a screen row back to a specific file line for
// click-to-comment. Code is syntax-highlighted over the diff background bands.

import type { Comment, DiffFile, LineAnchor, LineComment, Reply, Step, Walk } from "../types.ts";
import { highlightLine, langFor } from "./highlight.ts";
import { bandColors } from "./theme.ts";

export interface Row {
  ansi: string;
  /** Present when this row is a diff line that can be commented on. */
  anchor?: LineAnchor;
}

// Always-on ANSI (the pane forces color).
const e = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`;
const dim = (s: string) => e("2", s);
const bold = (s: string) => e("1", s);
const green = (s: string) => e("32", s);
const red = (s: string) => e("31", s);
const cyan = (s: string) => e("36", s);
const yellow = (s: string) => e("33", s);
const blue = (s: string) => e("34", s);
const magenta = (s: string) => e("35", s);

const RESET = "\x1b[0m";

function clip(s: string, budget: number): string {
  if (budget <= 1 || s.length <= budget) return s;
  return s.slice(0, Math.max(1, budget - 1)) + "…";
}

/** A diff code row: dim gutter + a background band carrying highlighted code. */
function codeRow(opts: {
  cols: number;
  wide: boolean;
  oldN?: number;
  newN?: number;
  marker: "+" | "-" | " ";
  band?: string;
  markColor?: string;
  content: string;
  lang: string | undefined;
}): string {
  const { cols, wide, oldN, newN, marker, band, markColor, content, lang } = opts;
  const oldS = String(oldN ?? "").padStart(4, " ");
  const newS = String(newN ?? "").padStart(4, " ");
  const gutter = dim(wide ? `${oldS} ${newS} ` : `${newS} `);
  const gutterW = wide ? 11 : 6;
  const budget = Math.max(8, cols - gutterW - 2);
  const clipped = clip(content, budget);
  const highlighted = highlightLine(clipped, lang);

  if (!band) {
    // Context line: no band, so no need to fill the row.
    const mark = dim(marker === " " ? "  " : `${marker} `);
    return gutter + mark + highlighted;
  }
  // Fill the band to the right edge so the background spans the row.
  const pad = " ".repeat(Math.max(0, cols - gutterW - 2 - clipped.length));
  return gutter + band + (markColor ?? "") + marker + " " + RESET + band + highlighted + pad + RESET;
}

function statusTag(status: DiffFile["status"]): string {
  const tag = { added: "[+]", deleted: "[-]", modified: "[~]", renamed: "[»]" }[status];
  const paint = { added: green, deleted: red, modified: yellow, renamed: blue }[status];
  return paint(tag);
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
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

const styleInline = (s: string) =>
  s.replace(/\*\*(.+?)\*\*/g, (_, t) => bold(t)).replace(/`([^`]+)`/g, (_, t) => cyan(t));

/** Light markdown flattening for prose/notes: wraps to width and styles inline. */
function proseRows(md: string, cols: number): Row[] {
  const rows: Row[] = [];
  for (const raw of md.split("\n")) {
    if (!raw.trim()) {
      rows.push({ ansi: "" });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(raw);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw);
    const quote = /^>\s?(.*)$/.exec(raw);
    const content = heading ? heading[1]! : bullet ? `• ${bullet[1]}` : quote ? `│ ${quote[1]}` : raw;
    for (const seg of wrap(content, cols)) {
      let styled = styleInline(seg);
      if (heading) styled = bold(styled);
      else if (quote) styled = dim(styled);
      rows.push({ ansi: styled });
    }
  }
  return rows;
}

function commentRows(c: Comment, cols: number): Row[] {
  const rows: Row[] = [];
  const bar = yellow("│");
  rows.push({ ansi: `      ${bar} ${dim(`${c.file}:${c.line}`)}` });
  for (const l of wrap(c.body, cols - 10)) rows.push({ ansi: `      ${bar} ${l}` });
  return rows;
}

function draftRows(c: LineComment, cols: number): Row[] {
  const bar = magenta("┆");
  const range = c.endLine && c.endLine > c.line ? `–${c.endLine}` : "";
  const rows: Row[] = [{ ansi: `      ${bar} ${magenta("staged")} ${dim(`${c.file}:${c.line}${range}`)}` }];
  for (const l of wrap(c.text, cols - 10)) rows.push({ ansi: `      ${bar} ${l}` });
  return rows;
}

function fileRows(file: DiffFile, comments: Comment[], cols: number, pending: LineComment[]): Row[] {
  const rows: Row[] = [];
  const path = file.status === "renamed" ? `${file.oldPath} → ${file.newPath}` : file.newPath || file.oldPath;
  const stat = dim("+") + green(String(file.additions)) + dim(" −") + red(String(file.deletions));
  rows.push({ ansi: `${statusTag(file.status)} ${bold(path)}  ${stat}` });
  if (file.binary) {
    rows.push({ ansi: dim("    (binary file)") });
    return rows;
  }
  const lang = langFor(file.newPath || file.oldPath);
  const bc = bandColors();
  const wide = cols >= 64;
  const fileComments = comments.filter((x) => x.file === file.newPath || x.file === file.oldPath);
  const commentsAt = (side: "old" | "new", line?: number) =>
    line == null ? [] : fileComments.filter((x) => x.side === side && x.line === line);
  const filePending = pending.filter((x) => x.file === file.newPath || x.file === file.oldPath);
  const pendingAt = (side: "old" | "new", line?: number) =>
    line == null ? [] : filePending.filter((x) => x.side === side && x.line === line);

  for (const hunk of file.hunks) {
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    rows.push({ ansi: cyan(clip(header + (hunk.section ? " " + hunk.section : ""), cols)) });
    for (const l of hunk.lines) {
      if (l.type === "add") {
        rows.push({
          ansi: codeRow({ cols, wide, newN: l.newNumber, marker: "+", band: bc.addBg, markColor: bc.addMark, content: l.content, lang }),
          anchor: l.newNumber != null ? { file: file.newPath, line: l.newNumber, side: "new" } : undefined,
        });
      } else if (l.type === "del") {
        rows.push({
          ansi: codeRow({ cols, wide, oldN: l.oldNumber, marker: "-", band: bc.delBg, markColor: bc.delMark, content: l.content, lang }),
          anchor: l.oldNumber != null ? { file: file.oldPath, line: l.oldNumber, side: "old" } : undefined,
        });
      } else {
        rows.push({
          ansi: codeRow({ cols, wide, oldN: l.oldNumber, newN: l.newNumber, marker: " ", content: l.content, lang }),
          anchor: l.newNumber != null ? { file: file.newPath, line: l.newNumber, side: "new" } : undefined,
        });
      }
      for (const c of commentsAt("old", l.oldNumber)) rows.push(...commentRows(c, cols));
      for (const c of commentsAt("new", l.newNumber)) rows.push(...commentRows(c, cols));
      for (const c of pendingAt("old", l.oldNumber)) rows.push(...draftRows(c, cols));
      for (const c of pendingAt("new", l.newNumber)) rows.push(...draftRows(c, cols));
    }
  }
  return rows;
}

function threadRows(replies: Reply[], cols: number): Row[] {
  if (!replies.length) return [];
  const rows: Row[] = [{ ansi: "" }];
  for (const r of replies) {
    const a = r.anchor;
    const loc = a ? `${a.file}:${a.line}${a.endLine && a.endLine > a.line ? `–${a.endLine}` : ""}` : "";
    const anchor = a ? dim(` · ${loc}`) : "";
    rows.push({ ansi: green("┌ ") + green("you") + anchor });
    for (const line of r.text.split("\n")) for (const w of wrap(line, cols - 4)) rows.push({ ansi: green("│ ") + w });
    rows.push({ ansi: green("└") });
  }
  return rows;
}

/** The scrollable content rows for the focused step. */
export function buildContentRows(step: Step, replies: Reply[], cols: number, pending: LineComment[] = []): Row[] {
  const rows: Row[] = [];
  if (step.kind === "prose") {
    rows.push(...proseRows(step.text, cols));
  } else {
    if (step.title) rows.push({ ansi: bold(step.title) }, { ansi: "" });
    if (step.note) rows.push(...proseRows(step.note, cols), { ansi: "" });
    for (const f of step.files) {
      rows.push(...fileRows(f, step.comments, cols, pending));
      rows.push({ ansi: "" });
    }
  }
  rows.push(...threadRows(replies.filter((r) => r.stepId === step.id), cols));
  return rows;
}
