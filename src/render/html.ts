import { marked } from "marked";
import type { Comment, DiffFile, DiffStep, Walk } from "../types.ts";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusBadge(status: DiffFile["status"]): string {
  const label = { added: "added", deleted: "deleted", modified: "modified", renamed: "renamed" }[status];
  return `<span class="badge badge-${status}">${label}</span>`;
}

function commentsFor(comments: Comment[], side: "old" | "new", line: number | undefined): Comment[] {
  if (line == null) return [];
  return comments.filter((c) => c.side === side && c.line === line);
}

function renderCommentRow(c: Comment): string {
  return `<tr class="comment-row"><td class="gutter"></td><td class="gutter"></td>` +
    `<td class="comment"><div class="comment-box"><span class="comment-anchor">${esc(c.file)}:${c.line}</span>` +
    `<div class="comment-body">${marked.parseInline(c.body) as string}</div></div></td></tr>`;
}

function renderFile(file: DiffFile, comments: Comment[]): string {
  const fileComments = comments.filter((c) => c.file === file.newPath || c.file === file.oldPath);
  const pathLabel = file.status === "renamed"
    ? `${esc(file.oldPath)} → ${esc(file.newPath)}`
    : esc(file.newPath || file.oldPath);

  let body = "";
  if (file.binary) {
    body = `<div class="binary">Binary file not shown.</div>`;
  } else if (file.hunks.length === 0) {
    body = `<div class="binary">No textual changes.</div>`;
  } else {
    const rows: string[] = [];
    for (const hunk of file.hunks) {
      rows.push(
        `<tr class="hunk-header"><td class="gutter"></td><td class="gutter"></td>` +
        `<td class="code">@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${esc(hunk.section)}</td></tr>`,
      );
      for (const l of hunk.lines) {
        const cls = l.type === "add" ? "line-add" : l.type === "del" ? "line-del" : "line-ctx";
        const marker = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
        rows.push(
          `<tr class="${cls}">` +
          `<td class="gutter">${l.oldNumber ?? ""}</td>` +
          `<td class="gutter">${l.newNumber ?? ""}</td>` +
          `<td class="code"><span class="marker">${marker}</span>${esc(l.content) || "&nbsp;"}</td></tr>`,
        );
        for (const c of commentsFor(fileComments, "old", l.oldNumber)) rows.push(renderCommentRow(c));
        for (const c of commentsFor(fileComments, "new", l.newNumber)) rows.push(renderCommentRow(c));
      }
    }
    body = `<table class="diff-table">${rows.join("")}</table>`;
  }

  return `<div class="file">
    <div class="file-header">${statusBadge(file.status)}<span class="file-path">${pathLabel}</span>` +
    `<span class="file-stat"><span class="add">+${file.additions}</span> <span class="del">−${file.deletions}</span></span></div>
    ${body}
  </div>`;
}

function renderDiffStep(step: DiffStep): string {
  const title = step.title ? `<h3 class="diff-title">${esc(step.title)}</h3>` : "";
  const note = step.note ? `<div class="diff-note">${marked.parse(step.note) as string}</div>` : "";
  const files = step.files.map((f) => renderFile(f, step.comments)).join("");
  return `<section class="step step-diff">${title}${note}${files}</section>`;
}

/** Render just the walk body (used for live-updating the browser view). */
export function renderFragment(walk: Walk | null): string {
  if (!walk) {
    return `<div class="empty">No active walk yet. Run <code>walk start "&lt;title&gt;"</code>.</div>`;
  }
  const steps = walk.steps.map((s) => {
    if (s.kind === "prose") {
      return `<section class="step step-prose">${marked.parse(s.text) as string}</section>`;
    }
    return renderDiffStep(s);
  });
  const body = steps.length
    ? steps.join("")
    : `<div class="empty">This walk has no steps yet.</div>`;
  return `<header class="walk-header"><h1>${esc(walk.title)}</h1></header>${body}`;
}

/** Full standalone HTML page shell that live-loads the fragment over SSE. */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>codewalk</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
<main id="walk"></main>
<div id="status" class="status">connecting…</div>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}

/** A fully self-contained static HTML document embedding one rendered walk. */
export function renderStandalone(walk: Walk): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(walk.title)} — codewalk</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
<main id="walk">${renderFragment(walk)}</main>
</body>
</html>`;
}

const PAGE_STYLES = `
:root {
  --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de;
  --code-bg: #f6f8fa; --add-bg: #e6ffec; --add-gutter: #ccffd8; --del-bg: #ffebe9;
  --del-gutter: #ffd7d5; --ctx: #1f2328; --marker-add: #1a7f37; --marker-del: #cf222e;
  --hunk-bg: #f6f8fa; --hunk-fg: #57606a; --accent: #0969da; --comment-bg: #fff8c5;
  --comment-border: #d4a72c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --border: #30363d;
    --code-bg: #161b22; --add-bg: #12261e; --add-gutter: #1b4721; --del-bg: #25171c;
    --del-gutter: #542426; --ctx: #e6edf3; --marker-add: #3fb950; --marker-del: #f85149;
    --hunk-bg: #161b22; --hunk-fg: #8b949e; --accent: #58a6ff; --comment-bg: #2d2a12;
    --comment-border: #6a5a1f;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
main { max-width: 980px; margin: 0 auto; padding: 24px 20px 96px; }
.walk-header h1 { font-size: 26px; margin: 4px 0 24px; letter-spacing: -0.01em; }
.step { margin: 0 0 28px; }
.step-prose { font-size: 16px; }
.step-prose p { margin: 0 0 12px; }
.step-prose code { background: var(--code-bg); padding: .15em .4em; border-radius: 5px; font-size: .9em; }
.step-prose h1,.step-prose h2,.step-prose h3 { margin: 20px 0 8px; letter-spacing: -0.01em; }
.step-prose ul,.step-prose ol { margin: 0 0 12px; padding-left: 22px; }
.step-prose blockquote { margin: 0 0 12px; padding-left: 14px; border-left: 3px solid var(--border); color: var(--muted); }
.diff-title { font-size: 17px; margin: 0 0 6px; }
.diff-note { color: var(--muted); margin: 0 0 12px; }
.diff-note p { margin: 0 0 8px; }
.file { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin: 0 0 16px; }
.file-header {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  background: var(--code-bg); border-bottom: 1px solid var(--border);
  font-size: 13px; position: sticky; top: 0; z-index: 2;
}
.file-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
.file-stat { margin-left: auto; font-family: ui-monospace, monospace; font-size: 12px; }
.file-stat .add { color: var(--marker-add); } .file-stat .del { color: var(--marker-del); }
.badge { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 20px; font-weight: 600; }
.badge-added { background: var(--add-gutter); color: var(--marker-add); }
.badge-deleted { background: var(--del-gutter); color: var(--marker-del); }
.badge-modified { background: var(--border); color: var(--muted); }
.badge-renamed { background: var(--border); color: var(--accent); }
.diff-table { width: 100%; border-collapse: collapse; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.diff-table td { padding: 0 8px; vertical-align: top; white-space: pre-wrap; word-break: break-word; }
.gutter { width: 1%; min-width: 40px; text-align: right; color: var(--muted); user-select: none; background: var(--code-bg); border-right: 1px solid var(--border); }
.code { width: 100%; color: var(--ctx); }
.code .marker { display: inline-block; width: 1ch; margin-right: 6px; color: var(--muted); }
.line-add { background: var(--add-bg); } .line-add .gutter { background: var(--add-gutter); }
.line-add .marker { color: var(--marker-add); }
.line-del { background: var(--del-bg); } .line-del .gutter { background: var(--del-gutter); }
.line-del .marker { color: var(--marker-del); }
.hunk-header td { background: var(--hunk-bg); color: var(--hunk-fg); padding: 4px 8px; }
.comment-row .comment { padding: 8px; }
.comment-box { background: var(--comment-bg); border: 1px solid var(--comment-border); border-radius: 6px; padding: 8px 12px; font-family: -apple-system, sans-serif; white-space: normal; }
.comment-anchor { display: block; font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; margin-bottom: 4px; }
.comment-body code { background: rgba(127,127,127,.15); padding: .1em .35em; border-radius: 4px; }
.binary { padding: 16px; color: var(--muted); font-style: italic; }
.empty { padding: 48px 0; color: var(--muted); text-align: center; }
.empty code { background: var(--code-bg); padding: .15em .4em; border-radius: 5px; }
.status { position: fixed; bottom: 12px; right: 12px; font-size: 12px; color: var(--muted); background: var(--code-bg); border: 1px solid var(--border); border-radius: 20px; padding: 4px 12px; }
.status.live { color: var(--marker-add); }
`;

const PAGE_SCRIPT = `
const walkEl = document.getElementById('walk');
const statusEl = document.getElementById('status');
async function refresh() {
  try {
    const res = await fetch('/fragment', { cache: 'no-store' });
    const html = await res.text();
    const y = window.scrollY;
    walkEl.innerHTML = html;
    window.scrollTo(0, y);
  } catch (e) { /* keep last render on transient failure */ }
}
function connect() {
  const es = new EventSource('/events');
  es.onopen = () => { statusEl.textContent = '● live'; statusEl.classList.add('live'); };
  es.addEventListener('update', refresh);
  es.onerror = () => {
    statusEl.textContent = 'reconnecting…'; statusEl.classList.remove('live');
    es.close(); setTimeout(connect, 1000);
  };
}
refresh();
connect();
`;
