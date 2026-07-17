import { marked } from "marked";
import { highlightHtml, langFor } from "./highlight-html.ts";
import type { Comment, DiffFile, DiffStep, Focus, Reply, Step, Walk } from "../types.ts";

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

  const lang = langFor(file.newPath || file.oldPath);
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
        // Each code row carries its identity so a click can stage a line comment.
        const side = l.type === "del" ? "old" : "new";
        const lineNo = l.type === "del" ? l.oldNumber : l.newNumber;
        const path = l.type === "del" ? file.oldPath : file.newPath;
        const attrs = lineNo != null
          ? ` data-file="${esc(path)}" data-line="${lineNo}" data-side="${side}"`
          : "";
        rows.push(
          `<tr class="${cls} commentable"${attrs}>` +
          `<td class="gutter">${l.oldNumber ?? ""}</td>` +
          `<td class="gutter">${l.newNumber ?? ""}</td>` +
          `<td class="code"><span class="marker">${marker}</span>${highlightHtml(l.content, lang) || "&nbsp;"}</td></tr>`,
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

function renderThread(replies: Reply[]): string {
  if (replies.length === 0) return "";
  const items = replies
    .map((r) => {
      const who = r.source === "web" ? "you" : r.source === "pane" ? "you (pane)" : "you (cli)";
      const a = r.anchor;
      const loc = a
        ? ` <span class="reply-anchor">${esc(a.file)}:${a.line}${a.endLine && a.endLine > a.line ? `–${a.endLine}` : ""}</span>`
        : "";
      return `<div class="reply"><span class="reply-who">${esc(who)}${loc}</span>` +
        `<div class="reply-body">${marked.parseInline(r.text) as string}</div></div>`;
    })
    .join("");
  return `<div class="reply-thread">${items}</div>`;
}

function renderStepInner(step: Step): string {
  if (step.kind === "prose") {
    return marked.parse(step.text) as string;
  }
  const s = step as DiffStep;
  const title = s.title ? `<h3 class="diff-title">${esc(s.title)}</h3>` : "";
  const note = s.note ? `<div class="diff-note">${marked.parse(s.note) as string}</div>` : "";
  const files = s.files.map((f) => renderFile(f, s.comments)).join("");
  return `${title}${note}${files}`;
}

function stepSection(step: Step, replies: Reply[]): string {
  const kind = step.kind === "prose" ? "step-prose" : "step-diff";
  const thread = renderThread(replies.filter((r) => r.stepId === step.id));
  return `<section class="step ${kind}" id="step-${esc(step.id)}" data-step-id="${esc(step.id)}">` +
    `${renderStepInner(step)}${thread}</section>`;
}

function progressDots(total: number, current: number): string {
  let dots = "";
  for (let i = 0; i < total; i++) dots += `<span class="dot${i <= current ? " on" : ""}"></span>`;
  return `<span class="dots">${dots}</span>`;
}

/**
 * The live browser fragment. Shows only the step the agent is currently
 * presenting (paced by the agent, so the reader can't jump ahead), with a
 * progress indicator. The static/standalone render shows the whole walk.
 */
export function renderFragment(
  walk: Walk | null,
  ctx: { focus?: Focus | null; replies?: Reply[] } = {},
): string {
  if (!walk) {
    return `<div class="empty">No active walk yet. Run <code>walk start "&lt;title&gt;"</code>.</div>`;
  }
  const replies = ctx.replies ?? [];
  const total = walk.steps.length;
  const seq = ctx.focus?.seq ?? 0;

  // Walk finished: a completion screen, no composer.
  if (ctx.focus?.done) {
    const summary = ctx.focus.summary
      ? `<p class="complete-summary">${marked.parseInline(ctx.focus.summary) as string}</p>`
      : "";
    const marker = `<div id="focus-marker" data-step-id="" data-seq="${seq}" data-done="1" hidden></div>`;
    return `${marker}<div class="complete"><div class="complete-check">✓</div>` +
      `<h1>All steps reviewed</h1>` +
      `<p class="complete-sub">${esc(walk.title)} · ${total} step${total === 1 ? "" : "s"}</p>${summary}</div>`;
  }

  const focusId = ctx.focus?.stepId ?? null;
  const idx = focusId ? walk.steps.findIndex((s) => s.id === focusId) : -1;
  const step = idx >= 0 ? walk.steps[idx] : null;

  // data-seq lets the client tell "agent advanced" (seq changed) from "same
  // step, just re-rendered" (e.g. a comment was added), which drives the
  // working indicator.
  const marker = `<div id="focus-marker" data-step-id="${esc(step ? step.id : "")}" data-seq="${seq}" hidden></div>`;
  const header =
    `<header class="walk-header"><div class="walk-eyebrow">${esc(walk.title)}</div>` +
    (step ? `<div class="walk-progress">${progressDots(total, idx)}<span class="step-count">Step ${idx + 1} of ${total}</span></div>` : "") +
    `</header>`;

  if (!step) {
    const msg = total ? "Waiting for the next step…" : "This walk has no steps yet.";
    return `${marker}${header}<div class="empty">${msg}</div>`;
  }
  return `${marker}${header}${stepSection(step, replies)}`;
}

/** The whole walk body, all steps (used by the standalone static render). */
function renderAllSteps(walk: Walk, replies: Reply[]): string {
  const marker = `<div id="focus-marker" data-step-id="" hidden></div>`;
  const body = walk.steps.length
    ? walk.steps.map((s) => stepSection(s, replies)).join("")
    : `<div class="empty">This walk has no steps yet.</div>`;
  return `${marker}<header class="walk-header"><h1>${esc(walk.title)}</h1></header>${body}`;
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
<div id="working" class="working" hidden><span class="spinner"></span><span id="working-text">Agent is reviewing your comments…</span></div>
<form id="composer" class="composer" hidden>
  <textarea id="composer-input" rows="1" placeholder="Overall note (optional) · Enter sends, Shift+Enter for a newline · click any line to comment"></textarea>
  <button type="submit" id="composer-send">Complete step</button>
</form>
<div id="status" class="status">connecting…</div>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}

/** A fully self-contained static HTML document embedding one rendered walk. */
export function renderStandalone(walk: Walk, ctx: { replies?: Reply[] } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(walk.title)} — codewalk</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
<main id="walk">${renderAllSteps(walk, ctx.replies ?? [])}</main>
</body>
</html>`;
}

const PAGE_STYLES = `
:root {
  --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de;
  --code-bg: #f6f8fa; --add-bg: #e6ffec; --add-gutter: #ccffd8; --del-bg: #ffebe9;
  --del-gutter: #ffd7d5; --ctx: #1f2328; --marker-add: #1a7f37; --marker-del: #cf222e;
  --hunk-bg: #f6f8fa; --hunk-fg: #57606a; --accent: #0969da; --comment-bg: #fff8c5;
  --comment-border: #d4a72c; --reply-bg: #ddf4ff; --reply-border: #54aeff; --surface: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --border: #30363d;
    --code-bg: #161b22; --add-bg: #12261e; --add-gutter: #1b4721; --del-bg: #25171c;
    --del-gutter: #542426; --ctx: #e6edf3; --marker-add: #3fb950; --marker-del: #f85149;
    --hunk-bg: #161b22; --hunk-fg: #8b949e; --accent: #58a6ff; --comment-bg: #2d2a12;
    --comment-border: #6a5a1f; --reply-bg: #121d2f; --reply-border: #1f6feb; --surface: #0d1117;
  }
}
:root[data-theme="light"] {
  --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de;
  --code-bg: #f6f8fa; --add-bg: #e6ffec; --add-gutter: #ccffd8; --del-bg: #ffebe9;
  --del-gutter: #ffd7d5; --ctx: #1f2328; --marker-add: #1a7f37; --marker-del: #cf222e;
  --hunk-bg: #f6f8fa; --hunk-fg: #57606a; --accent: #0969da; --comment-bg: #fff8c5;
  --comment-border: #d4a72c; --reply-bg: #ddf4ff; --reply-border: #54aeff; --surface: #ffffff;
}
:root[data-theme="dark"] {
  --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --border: #30363d;
  --code-bg: #161b22; --add-bg: #12261e; --add-gutter: #1b4721; --del-bg: #25171c;
  --del-gutter: #542426; --ctx: #e6edf3; --marker-add: #3fb950; --marker-del: #f85149;
  --hunk-bg: #161b22; --hunk-fg: #8b949e; --accent: #58a6ff; --comment-bg: #2d2a12;
  --comment-border: #6a5a1f; --reply-bg: #121d2f; --reply-border: #1f6feb; --surface: #0d1117;
}
/* Syntax palette (light default, overridden per theme). GitHub-ish. */
:root { --syn-key: #cf222e; --syn-str: #0a3069; --syn-num: #0550ae; --syn-com: #6e7781; --syn-fn: #8250df; --syn-type: #953800; --syn-attr: #0550ae; }
@media (prefers-color-scheme: dark) {
  :root { --syn-key: #ff7b72; --syn-str: #a5d6ff; --syn-num: #79c0ff; --syn-com: #8b949e; --syn-fn: #d2a8ff; --syn-type: #ffa657; --syn-attr: #79c0ff; }
}
:root[data-theme="light"] { --syn-key: #cf222e; --syn-str: #0a3069; --syn-num: #0550ae; --syn-com: #6e7781; --syn-fn: #8250df; --syn-type: #953800; --syn-attr: #0550ae; }
:root[data-theme="dark"] { --syn-key: #ff7b72; --syn-str: #a5d6ff; --syn-num: #79c0ff; --syn-com: #8b949e; --syn-fn: #d2a8ff; --syn-type: #ffa657; --syn-attr: #79c0ff; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-doctag, .hljs-operator { color: var(--syn-key); }
.hljs-string, .hljs-regexp, .hljs-char.escape_, .hljs-subst { color: var(--syn-str); }
.hljs-number { color: var(--syn-num); }
.hljs-comment, .hljs-quote { color: var(--syn-com); font-style: italic; }
.hljs-title, .hljs-title.function_, .hljs-function .hljs-title { color: var(--syn-fn); }
.hljs-type, .hljs-class .hljs-title, .hljs-title.class_, .hljs-built_in { color: var(--syn-type); }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-property, .hljs-params, .hljs-template-variable { color: var(--syn-attr); }
.hljs-tag, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: var(--syn-key); }
.hljs-meta { color: var(--syn-com); }
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
main { max-width: 980px; margin: 0 auto; padding: 24px 20px 140px; }
.walk-header h1 { font-size: 26px; margin: 4px 0 24px; letter-spacing: -0.01em; }
.walk-eyebrow { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin: 2px 0 10px; }
.walk-progress { display: flex; align-items: center; gap: 12px; margin: 0 0 24px; }
.walk-progress .dots { display: inline-flex; gap: 6px; }
.walk-progress .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); transition: background .2s; }
.walk-progress .dot.on { background: var(--accent); }
.walk-progress .step-count { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.step { margin: 0 0 28px; scroll-margin-top: 16px; border-radius: 10px; transition: box-shadow .2s, background .2s; }
.step.focused { background: color-mix(in srgb, var(--accent) 7%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent); padding: 16px; margin-left: -16px; margin-right: -16px; }
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
.reply-thread { margin: 12px 0 0; display: flex; flex-direction: column; gap: 8px; }
.reply { background: var(--reply-bg); border: 1px solid var(--reply-border); border-radius: 8px; padding: 8px 12px; }
.reply-who { display: block; font-size: 11px; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
.reply-anchor { font-family: ui-monospace, monospace; text-transform: none; color: var(--muted); font-weight: 500; }
.reply-body { white-space: normal; }
.reply-body code { background: rgba(127,127,127,.15); padding: .1em .35em; border-radius: 4px; }
.binary { padding: 16px; color: var(--muted); font-style: italic; }
.empty { padding: 48px 0; color: var(--muted); text-align: center; }
.complete { min-height: 70vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 6px; }
.complete-check { width: 68px; height: 68px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 34px; color: #fff; background: var(--marker-add); margin-bottom: 14px; animation: pop .35s cubic-bezier(.2,.9,.3,1.4); }
.complete h1 { font-size: 24px; margin: 0; letter-spacing: -0.01em; }
.complete-sub { color: var(--muted); margin: 2px 0 0; }
.complete-summary { max-width: 60ch; margin: 14px 0 0; color: var(--fg); }
@keyframes pop { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .complete-check { animation: none; } }
.empty code { background: var(--code-bg); padding: .15em .4em; border-radius: 5px; }
.composer {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px;
  width: min(900px, calc(100% - 32px)); display: flex; gap: 8px; align-items: flex-end;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.18); z-index: 10;
}
.composer textarea {
  flex: 1; resize: none; border: none; outline: none; background: transparent;
  color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  padding: 6px 8px; max-height: 160px;
}
.composer button {
  border: none; border-radius: 8px; background: var(--accent); color: #fff;
  font-size: 13px; font-weight: 600; padding: 8px 14px; cursor: pointer; white-space: nowrap;
}
.composer button:disabled { opacity: .5; cursor: default; }
.composer .pending-count { display: inline-block; margin-left: 6px; background: rgba(255,255,255,.25); border-radius: 10px; padding: 0 7px; font-size: 12px; }
.status { position: fixed; bottom: 16px; right: 16px; font-size: 12px; color: var(--muted); background: var(--code-bg); border: 1px solid var(--border); border-radius: 20px; padding: 4px 12px; z-index: 11; }
.status.live { color: var(--marker-add); }
.status.sent { color: var(--accent); }
/* Click-to-comment affordance on code rows. */
.commentable { cursor: pointer; }
.commentable:hover .gutter::after { content: "+"; position: absolute; margin-left: -14px; color: var(--accent); font-weight: 700; }
.commentable:hover { outline: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); outline-offset: -1px; }
/* A staged (not yet sent) line comment. */
.draft-row td { padding: 8px; }
.draft-box { background: var(--comment-bg); border: 1px dashed var(--comment-border); border-radius: 6px; padding: 8px 12px; font-family: -apple-system, sans-serif; }
.draft-box .draft-label { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; margin-bottom: 4px; }
.draft-box .draft-tag { color: var(--accent); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
.draft-box textarea { width: 100%; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); font: 13px/1.5 -apple-system, sans-serif; padding: 6px 8px; resize: vertical; }
.draft-box .draft-actions { margin-top: 6px; display: flex; gap: 8px; }
.draft-box button { border: none; border-radius: 6px; font-size: 12px; font-weight: 600; padding: 5px 10px; cursor: pointer; }
.draft-box .draft-add { background: var(--accent); color: #fff; }
.draft-box .draft-cancel { background: var(--code-bg); color: var(--muted); }
.draft-box.staged { border-style: solid; }
.draft-box.staged .draft-text { white-space: normal; }
.working {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px;
  width: min(900px, calc(100% - 32px)); display: flex; align-items: center; gap: 12px;
  background: var(--surface); border: 1px solid var(--accent); border-radius: 12px;
  padding: 14px 18px; box-shadow: 0 8px 30px rgba(0,0,0,.18); z-index: 12;
  font-size: 14px; color: var(--fg);
}
/* The [hidden] attribute must win over the flex display above. */
.working[hidden], .composer[hidden] { display: none; }
.spinner { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }
`;

const PAGE_SCRIPT = `
const walkEl = document.getElementById('walk');
const statusEl = document.getElementById('status');
const composer = document.getElementById('composer');
const input = document.getElementById('composer-input');
const sendBtn = document.getElementById('composer-send');
const workingEl = document.getElementById('working');
let firstLoad = true;

// Staged (not yet sent) line comments for the current step, and the working
// state that shows while the agent reviews a completed step.
let pending = [];
let working = false;
let workingSeq = null;

function marker() { return document.getElementById('focus-marker'); }
function currentFocusId() { const m = marker(); return m ? (m.getAttribute('data-step-id') || '') : ''; }
function currentSeq() { const m = marker(); return m ? (m.getAttribute('data-seq') || '') : ''; }
function key(c) { return c.file + ':' + c.side + ':' + c.line; }

function syncUI() {
  const id = currentFocusId();
  composer.hidden = !id || working;
  workingEl.hidden = !working;
  const n = pending.length;
  sendBtn.textContent = 'Complete step';
  if (n) sendBtn.innerHTML = 'Complete step<span class="pending-count">' + n + '</span>';
}

// Re-inject staged draft boxes under their rows after every fragment refresh.
function renderPending() {
  for (const c of pending) {
    const sel = 'tr.commentable[data-file="' + (window.CSS ? CSS.escape(c.file) : c.file) + '"][data-line="' + c.line + '"][data-side="' + c.side + '"]';
    const row = walkEl.querySelector(sel);
    if (!row) continue;
    const tr = document.createElement('tr');
    tr.className = 'draft-row';
    tr.innerHTML = '<td class="gutter"></td><td class="gutter"></td><td><div class="draft-box staged">' +
      '<div class="draft-label"><span class="draft-tag">staged</span> ' + c.file + ':' + c.line + '</div>' +
      '<div class="draft-text"></div></div></td>';
    tr.querySelector('.draft-text').textContent = c.text;
    row.after(tr);
  }
  syncUI();
}

let activeDraft = null;
function openDraft(row) {
  if (working) return;
  if (activeDraft) activeDraft.remove();
  const file = row.getAttribute('data-file');
  const line = parseInt(row.getAttribute('data-line'), 10);
  const side = row.getAttribute('data-side');
  const tr = document.createElement('tr');
  tr.className = 'draft-row';
  tr.innerHTML = '<td class="gutter"></td><td class="gutter"></td><td><div class="draft-box">' +
    '<div class="draft-label"><span class="draft-tag">new comment</span> ' + file + ':' + line + '</div>' +
    '<textarea rows="2" placeholder="Comment on this line… (Enter stages · Shift+Enter newline · Esc cancels)"></textarea>' +
    '<div class="draft-actions"><button class="draft-add" type="button">Add comment</button>' +
    '<button class="draft-cancel" type="button">Cancel</button></div></div></td>';
  row.after(tr);
  activeDraft = tr;
  const ta = tr.querySelector('textarea');
  ta.focus();
  const commit = () => {
    const text = ta.value.trim();
    if (text) { pending = pending.filter(p => key(p) !== key({file,line,side})); pending.push({ file, line, side, text }); }
    activeDraft = null; tr.remove(); renderPending();
  };
  const cancel = () => { activeDraft = null; tr.remove(); };
  tr.querySelector('.draft-add').addEventListener('click', commit);
  tr.querySelector('.draft-cancel').addEventListener('click', cancel);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

walkEl.addEventListener('click', (e) => {
  const row = e.target.closest('tr.commentable');
  if (row && !e.target.closest('.draft-box')) openDraft(row);
});

async function complete() {
  const stepId = currentFocusId();
  if (!stepId || working) return;
  // Empty + nothing staged means "looks good, continue" — same as the pane.
  const message = input.value.trim() || (pending.length === 0 ? '👍 Looks good — continue.' : '');
  working = true; workingSeq = currentSeq(); activeDraft = null;
  syncUI();
  try {
    await fetch('/api/reply', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, comments: pending, stepId }),
    });
    pending = []; input.value = ''; input.style.height = 'auto';
  } catch (e) {
    working = false; statusEl.textContent = 'send failed'; syncUI();
  }
}

async function refresh() {
  try {
    const res = await fetch('/fragment', { cache: 'no-store' });
    const html = await res.text();
    const prevFocus = currentFocusId();
    const y = window.scrollY;
    walkEl.innerHTML = html;
    // Clear the working state once the agent advances or re-presents (seq changed).
    if (working && currentSeq() !== workingSeq) { working = false; pending = []; }
    renderPending();
    const newFocus = currentFocusId();
    if (newFocus && newFocus !== prevFocus) window.scrollTo({ top: 0, behavior: firstLoad ? 'auto' : 'smooth' });
    else window.scrollTo(0, y);
    firstLoad = false;
  } catch (e) { /* keep last render on transient failure */ }
}

composer.addEventListener('submit', (e) => { e.preventDefault(); complete(); });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });
// Enter sends; Shift+Enter and Opt/Alt+Enter insert a newline.
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); complete(); } });

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
