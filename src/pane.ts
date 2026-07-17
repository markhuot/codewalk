// The interactive reviewer that runs inside a herdr pane (`walk pane`).
//
// A real terminal UI: alternate screen, a fixed header, a scrollable diff
// viewport (wheel / arrows / page keys), mouse click-to-comment on any line,
// and a bordered input box. The agent presents a step (bumping the focus seq);
// the reviewer renders it and lets the human scroll, click a line to comment, or
// type a reply. Every submission lands in the shared reply inbox.

import { watch } from "node:fs";
import { stdin, stdout } from "node:process";
import {
  addCommentToCurrentStep,
  clearPaneId,
  clearReviewerPid,
  getFocus,
  getPaneId,
  getSession,
  listReplies,
  setReviewerPid,
  stateDir,
  writeReply,
} from "./store.ts";
import { activeDriver } from "./panes/index.ts";
import { buildContentRows, type Row } from "./render/rows.ts";
import type { Focus, LineAnchor, LineComment, Session, Step } from "./types.ts";

const HEADER_H = 3;
const FOOTER_H = 3;

// ── Screen control ────────────────────────────────────────────────────────
const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const WRAP_OFF = "\x1b[?7l";
const WRAP_ON = "\x1b[?7h";
// 1002 = button-event tracking (press, release, and motion *while a button is
// held* → drag), 1006 = SGR extended coordinates (also carries wheel events).
const MOUSE_ON = "\x1b[?1002h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1002l\x1b[?1006l";
const CLEAR_EOL = "\x1b[K";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const accent = (s: string) => `\x1b[38;2;88;166;255m${s}\x1b[0m`;

interface State {
  session: Session | null;
  focus: Focus | null;
  step: Step | null;
  rows: Row[];
  scroll: number;
  input: string;
  commentTarget: LineAnchor | null;
  dragging: boolean;
  dragStartLine: number;
  pending: LineComment[];
  working: boolean;
  workingSeq: number;
  spinFrame: number;
  finished: boolean;
  status: string;
  lastSeq: number;
}

const state: State = {
  session: null,
  focus: null,
  step: null,
  rows: [],
  scroll: 0,
  input: "",
  commentTarget: null,
  dragging: false,
  dragStartLine: 0,
  pending: [],
  working: false,
  workingSeq: -1,
  spinFrame: 0,
  finished: false,
  status: "",
  lastSeq: -1,
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinTimer: ReturnType<typeof setInterval> | null = null;
function startSpinner(): void {
  if (spinTimer) return;
  spinTimer = setInterval(() => {
    state.spinFrame = (state.spinFrame + 1) % SPINNER.length;
    render();
  }, 90);
}
function stopSpinner(): void {
  if (spinTimer) clearInterval(spinTimer);
  spinTimer = null;
}

/** After showing the completion screen, close the pane (and this process). */
function scheduleClose(): void {
  setTimeout(() => {
    const paneId = getPaneId();
    clearReviewerPid();
    clearPaneId();
    try {
      if (paneId) activeDriver()?.close(paneId);
    } catch {
      /* pane may already be gone */
    }
    teardown();
    process.exit(0);
  }, 2600);
}

const SELECTION_BG = "\x1b[48;2;40;52;74m";

/** Describe the current comment target for the footer/status. */
function targetLabel(t: LineAnchor): string {
  return t.endLine && t.endLine > t.line ? `${t.file}:${t.line}–${t.endLine}` : `${t.file}:${t.line}`;
}

/** Is this row's anchor inside the active selection? */
function rowSelected(row: Row): boolean {
  const t = state.commentTarget;
  if (!t || !row.anchor) return false;
  if (row.anchor.file !== t.file || row.anchor.side !== t.side) return false;
  const hi = t.endLine ?? t.line;
  return row.anchor.line >= t.line && row.anchor.line <= hi;
}

function cols(): number {
  return Math.max(stdout.columns || 80, 20);
}
function screenRows(): number {
  return Math.max(stdout.rows || 24, HEADER_H + FOOTER_H + 2);
}
function viewportH(): number {
  return Math.max(1, screenRows() - HEADER_H - FOOTER_H);
}
function maxScroll(): number {
  return Math.max(0, state.rows.length - viewportH());
}

/** Reload session/focus and rebuild rows. Resets scroll when the agent advances. */
function loadState(): void {
  state.session = getSession();
  state.focus = getFocus();

  const step = state.session?.step ?? null;
  state.step = step;

  const seq = state.focus?.seq ?? 0;
  const advanced = seq !== state.lastSeq;
  state.lastSeq = seq;

  // The walk was finished — show the completion screen and close the pane.
  if (state.focus?.done && !state.finished) {
    state.finished = true;
    stopSpinner();
    scheduleClose();
  }

  state.rows = step ? buildContentRows(step, listReplies(), cols(), state.pending) : [{ ansi: dim("Waiting for the agent to present a step…") }];

  if (advanced) {
    // The agent moved on — clear the working state and any leftover drafts.
    state.scroll = 0;
    state.commentTarget = null;
    state.dragging = false;
    if (state.working) {
      state.working = false;
      stopSpinner();
      state.pending = [];
      state.status = "";
    }
  } else {
    state.scroll = Math.min(state.scroll, maxScroll());
  }
}

function truncateVisible(s: string, max: number): string {
  // Rows are pre-clipped, but header/footer strings we build here are plain.
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

function fillRule(prefix: string, cols_: number): string {
  const plain = prefix.replace(/\x1b\[[0-9;]*m/g, "");
  const dashes = Math.max(0, cols_ - plain.length);
  return prefix + "─".repeat(dashes);
}

function header(c: number): string[] {
  const session = state.session;
  const title = session ? session.title : "codewalk review";
  const progress = state.step?.progress ? `step ${state.step.progress}` : "";
  const l1 = truncateVisible(title, c - progress.length - 3);
  const line1 = `${bold(l1)}   ${dim(progress)}`;

  // One step at a time, no stored backlog — nothing to breadcrumb.
  const line2 = dim("");

  // Rule with a right-aligned scroll indicator.
  const total = state.rows.length;
  const from = total ? state.scroll + 1 : 0;
  const to = Math.min(total, state.scroll + viewportH());
  const indicator = ` ${from}–${to}/${total} `;
  const ruleWidth = Math.max(0, c - indicator.length);
  const line3 = dim("─".repeat(ruleWidth)) + dim(indicator);

  return [line1 + CLEAR_EOL, line2 + CLEAR_EOL, line3 + CLEAR_EOL];
}

function footer(c: number): { lines: string[]; caretCol: number } {
  if (state.working) {
    const top = dim(fillRule("╭─ sent ", c - 1) + "╮");
    const label = `${SPINNER[state.spinFrame]} Agent is reviewing your comments…`;
    const inner = Math.max(0, c - 4); // "│ " … " │"
    const clipped = label.length > inner ? label.slice(0, inner) : label;
    const pad = " ".repeat(Math.max(0, inner - clipped.length));
    const mid = dim("│") + " " + accent(clipped.slice(0, 1)) + clipped.slice(1) + pad + " " + dim("│");
    const bottom = dim(fillRule("╰─ waiting for the next step ", c - 1) + "╯");
    return { lines: [top + CLEAR_EOL, mid + CLEAR_EOL, bottom + CLEAR_EOL], caretCol: 1 };
  }
  const target = state.commentTarget;
  const topLabel = target ? ` commenting on ${targetLabel(target)} ` : ` comment `;
  const top = target
    ? accent(fillRule("╭─" + topLabel, c - 1) + "╮")
    : dim(fillRule("╭─" + topLabel, c - 1) + "╮");

  const prefix = "│ › ";
  const budget = Math.max(4, c - prefix.length - 2); // -2 for " │" on the right
  // Keep the footer one line: show embedded newlines as a ⏎ marker.
  let shown = state.input.replace(/\n/g, "⏎ ");
  if (shown.length > budget) shown = shown.slice(shown.length - budget);
  const padLen = Math.max(0, budget - shown.length);
  const inputLine = dim("│") + " " + accent("›") + " " + shown + " ".repeat(padLen) + " " + dim("│");
  const caretCol = 1 + 1 + 1 + 1 + shown.length + 1; // │, space, ›, space, text → 1-based

  const staged = state.pending.length ? `${state.pending.length} staged · ` : "";
  const hint = state.status
    ? ` ${state.status} `
    : ` ${staged}click a line · Enter sends · Opt+Enter newline · ↑↓/wheel scroll · Ctrl-C quit `;
  const bottom = dim(fillRule("╰─" + truncateVisible(hint, c - 4), c - 1) + "╯");

  return { lines: [top + CLEAR_EOL, inputLine + CLEAR_EOL, bottom + CLEAR_EOL], caretCol };
}

/** The end-of-walk screen: centered, then the pane closes itself. */
function renderComplete(): void {
  const c = cols();
  const r = screenRows();
  const block: string[] = [
    green("✓  Walk complete"),
    ...(state.focus?.summary ? ["", state.focus.summary] : []),
    "",
    dim("closing this pane…"),
  ];
  const center = (s: string) => {
    const plain = s.replace(/\x1b\[[0-9;]*m/g, "");
    const pad = Math.max(0, Math.floor((c - plain.length) / 2));
    return " ".repeat(pad) + s;
  };
  const top = Math.max(0, Math.floor((r - block.length) / 2));
  const out = CURSOR_HIDE + "\x1b[2J\x1b[3J\x1b[H" + "\n".repeat(top) + block.map(center).join("\n");
  stdout.write(out);
}

function render(): void {
  if (state.finished) {
    renderComplete();
    return;
  }
  const c = cols();
  const vh = viewportH();
  const lines: string[] = [];

  lines.push(...header(c));

  for (let i = 0; i < vh; i++) {
    const row = state.rows[state.scroll + i];
    if (row && rowSelected(row)) {
      // Tint the row to show it's part of the click-drag selection. The row's
      // own bands override where they set a background; the gutter picks it up.
      lines.push(SELECTION_BG + row.ansi + "\x1b[49m" + CLEAR_EOL);
    } else {
      lines.push((row ? row.ansi : "") + CLEAR_EOL);
    }
  }

  const foot = footer(c);
  lines.push(...foot.lines);

  const caretRow = HEADER_H + vh + 2; // 1-based: the input line
  const out =
    CURSOR_HIDE +
    "\x1b[H" +
    lines.join("\n") +
    `\x1b[${caretRow};${foot.caretCol}H` +
    CURSOR_SHOW;
  stdout.write(out);
}

// ── Input ───────────────────────────────────────────────────────────────────
function scrollBy(n: number): void {
  state.scroll = Math.min(Math.max(0, state.scroll + n), maxScroll());
}

function anchorAtRow(y: number): LineAnchor | undefined {
  if (y <= HEADER_H || y > HEADER_H + viewportH()) return undefined; // y is 1-based
  return state.rows[state.scroll + (y - HEADER_H - 1)]?.anchor;
}

function handleMouse(b: number, y: number, final: "M" | "m"): void {
  if (b === 64) return scrollBy(-3); // wheel up
  if (b === 65) return scrollBy(3); // wheel down

  if (final === "m") {
    state.dragging = false; // release: keep whatever range we accumulated
    return;
  }
  if ((b & 3) !== 0) return; // only the left button

  const anchor = anchorAtRow(y);
  if (!anchor) return;
  const motion = (b & 32) !== 0;

  if (motion && state.dragging && state.commentTarget) {
    // Extend the selection (same file/side only).
    if (anchor.file !== state.commentTarget.file || anchor.side !== state.commentTarget.side) return;
    const lo = Math.min(state.dragStartLine, anchor.line);
    const hi = Math.max(state.dragStartLine, anchor.line);
    state.commentTarget = { file: anchor.file, side: anchor.side, line: lo, ...(hi > lo ? { endLine: hi } : {}) };
  } else if (!motion) {
    // Press: begin a new selection at this line.
    state.dragging = true;
    state.dragStartLine = anchor.line;
    state.commentTarget = { file: anchor.file, line: anchor.line, side: anchor.side };
  }
  if (state.commentTarget) {
    state.status = `commenting on ${targetLabel(state.commentTarget)} — type and press Enter (Esc to cancel)`;
  }
}

/** Enter with a line targeted stages a comment; Enter with no target completes
 * the step, sending the note plus every staged comment as one submission. */
function submit(): void {
  if (state.working) return;
  const text = state.input.trim();
  const target = state.commentTarget;

  if (target) {
    if (!text) {
      // Empty Enter cancels the line selection.
      state.commentTarget = null;
      state.dragging = false;
      state.status = "";
      return;
    }
    // Replace any earlier draft on the same line, then stage this one.
    state.pending = state.pending.filter((p) => !(p.file === target.file && p.side === target.side && p.line === target.line));
    state.pending.push({ file: target.file, line: target.line, side: target.side, ...(target.endLine ? { endLine: target.endLine } : {}), text });
    state.commentTarget = null;
    state.dragging = false;
    state.input = "";
    state.status = `staged ${state.pending.length} comment(s) — Enter to send, or click another line`;
    loadState();
    return;
  }

  complete(text);
}

/** Send the note plus all staged comments, then wait (working) for the agent. */
function complete(message: string): void {
  const label = state.step?.progress ?? null;
  if (!message && state.pending.length === 0) {
    writeReply("👍 Looks good — continue.", { stepId: label, source: "pane" });
  } else {
    for (const c of state.pending) {
      const body = c.endLine && c.endLine > c.line ? `(lines ${c.line}–${c.endLine}) ${c.text}` : c.text;
      addCommentToCurrentStep({ file: c.file, line: c.line, side: c.side, body });
    }
    writeReply(message, { stepId: label, source: "pane", comments: state.pending });
  }
  state.working = true;
  state.workingSeq = state.focus?.seq ?? 0;
  state.pending = [];
  state.input = "";
  state.commentTarget = null;
  state.dragging = false;
  startSpinner();
  loadState();
}

function handleData(buf: string): void {
  let i = 0;
  while (i < buf.length) {
    const ch = buf[i]!;

    // Once finished, the pane is closing; ignore everything but Ctrl-C.
    if (state.finished) {
      if (ch === "\x03") {
        teardown();
        process.exit(0);
      }
      i += 1;
      continue;
    }

    if (ch === "\x1b") {
      const rest = buf.slice(i);
      // Opt/Alt+Enter (ESC + CR/LF) inserts a newline instead of sending.
      if (rest[1] === "\r" || rest[1] === "\n") {
        if (!state.working) state.input += "\n";
        i += 2;
        continue;
      }
      const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest);
      if (mouse) {
        handleMouse(parseInt(mouse[1]!, 10), parseInt(mouse[3]!, 10), mouse[4] as "M" | "m");
        i += mouse[0].length;
        continue;
      }
      const nav = /^\x1b\[(A|B|C|D|H|F|5~|6~)/.exec(rest);
      if (nav) {
        const key = nav[1];
        if (key === "A") scrollBy(-1);
        else if (key === "B") scrollBy(1);
        else if (key === "5~") scrollBy(-viewportH());
        else if (key === "6~") scrollBy(viewportH());
        else if (key === "H") state.scroll = 0;
        else if (key === "F") state.scroll = maxScroll();
        i += nav[0].length;
        continue;
      }
      const csi = /^\x1b\[[0-9;<]*[A-Za-z~]/.exec(rest);
      if (csi) {
        i += csi[0].length; // unknown CSI, skip
        continue;
      }
      // Lone ESC: cancel a pending comment target/selection.
      state.commentTarget = null;
      state.dragging = false;
      state.status = "";
      i += 1;
      continue;
    }

    if (ch === "\x03") {
      teardown();
      process.exit(0);
    }
    if (ch === "\r" || ch === "\n") {
      submit();
      i += 1;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      if (!state.working) state.input = state.input.slice(0, -1);
      i += 1;
      continue;
    }
    if (buf.charCodeAt(i) >= 0x20 && !state.working) state.input += ch;
    i += 1;
  }
  render();
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
let torn = false;
function teardown(): void {
  if (torn) return;
  torn = true;
  stopSpinner();
  try {
    if (stdin.isTTY) stdin.setRawMode(false);
  } catch {
    /* ignore */
  }
  stdout.write(MOUSE_OFF + WRAP_ON + CURSOR_SHOW + ALT_OFF);
  clearReviewerPid();
}

export async function runReviewer(): Promise<void> {
  setReviewerPid(process.pid);
  stdout.write(ALT_ON + WRAP_OFF + CURSOR_HIDE + MOUSE_ON);

  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", (d: string) => handleData(typeof d === "string" ? d : String(d)));

  process.on("SIGINT", () => {
    teardown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    teardown();
    process.exit(0);
  });
  process.on("exit", teardown);

  loadState();
  render();

  // Live updates: any state change (a new step, a reply, a focus bump) rebuilds
  // and repaints. Debounced so a burst of writes coalesces.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(stateDir(), { recursive: true }, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      loadState();
      render();
    }, 40);
  });

  stdout.on("resize", () => {
    loadState();
    render();
  });

  // Keep the process alive until the pane closes or Ctrl-C.
  await new Promise<void>((resolve) => {
    process.on("SIGHUP", () => {
      watcher.close();
      resolve();
    });
  });
}
