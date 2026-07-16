import { marked } from "marked";
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

/** Render just the walk body (used for live-updating the browser view). */
export function renderFragment(
  walk: Walk | null,
  ctx: { focus?: Focus | null; replies?: Reply[] } = {},
): string {
  if (!walk) {
    return `<div class="empty">No active walk yet. Run <code>walk start "&lt;title&gt;"</code>.</div>`;
  }
  const focusId = ctx.focus?.stepId ?? null;
  const replies = ctx.replies ?? [];

  const steps = walk.steps.map((step) => {
    const kind = step.kind === "prose" ? "step-prose" : "step-diff";
    const focused = step.id === focusId ? " focused" : "";
    const thread = renderThread(replies.filter((r) => r.stepId === step.id));
    return `<section class="step ${kind}${focused}" id="step-${esc(step.id)}" data-step-id="${esc(step.id)}">` +
      `${renderStepInner(step)}${thread}</section>`;
  });

  const body = steps.length
    ? steps.join("")
    : `<div class="empty">This walk has no steps yet.</div>`;
  // A marker the composer reads to know which step a browser reply belongs to.
  const marker = `<div id="focus-marker" data-step-id="${esc(focusId ?? "")}" hidden></div>`;
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
<form id="composer" class="composer" hidden>
  <textarea id="composer-input" rows="1" placeholder="Comment on this step… (⌘/Ctrl+Enter to send)"></textarea>
  <button type="submit" id="composer-send">Send to Claude</button>
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
<main id="walk">${renderFragment(walk, { replies: ctx.replies })}</main>
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
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
main { max-width: 980px; margin: 0 auto; padding: 24px 20px 140px; }
.walk-header h1 { font-size: 26px; margin: 4px 0 24px; letter-spacing: -0.01em; }
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
.status { position: fixed; bottom: 16px; right: 16px; font-size: 12px; color: var(--muted); background: var(--code-bg); border: 1px solid var(--border); border-radius: 20px; padding: 4px 12px; z-index: 11; }
.status.live { color: var(--marker-add); }
.status.sent { color: var(--accent); }
`;

const PAGE_SCRIPT = `
const walkEl = document.getElementById('walk');
const statusEl = document.getElementById('status');
const composer = document.getElementById('composer');
const input = document.getElementById('composer-input');
const sendBtn = document.getElementById('composer-send');
let firstLoad = true;

function currentFocusId() {
  const m = document.getElementById('focus-marker');
  return m ? (m.getAttribute('data-step-id') || '') : '';
}

function syncComposer() {
  const id = currentFocusId();
  composer.hidden = !id;
}

function scrollToFocus(force) {
  const id = currentFocusId();
  if (!id) return;
  const el = document.getElementById('step-' + id);
  if (el) el.scrollIntoView({ behavior: firstLoad || force ? 'auto' : 'smooth', block: 'start' });
}

async function refresh() {
  try {
    const res = await fetch('/fragment', { cache: 'no-store' });
    const html = await res.text();
    const prevFocus = currentFocusId();
    const y = window.scrollY;
    walkEl.innerHTML = html;
    syncComposer();
    const newFocus = currentFocusId();
    if (newFocus && newFocus !== prevFocus) scrollToFocus(false);
    else window.scrollTo(0, y);
    firstLoad = false;
  } catch (e) { /* keep last render on transient failure */ }
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  sendBtn.disabled = true;
  try {
    await fetch('/api/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, stepId: currentFocusId() }),
    });
    input.value = '';
    input.style.height = 'auto';
    statusEl.textContent = '✓ sent to Claude';
    statusEl.classList.add('sent');
    setTimeout(() => statusEl.classList.remove('sent'), 2000);
  } catch (e) {
    statusEl.textContent = 'send failed';
  } finally {
    sendBtn.disabled = false;
  }
}

composer.addEventListener('submit', (e) => { e.preventDefault(); send(); });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });
input.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
});

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
