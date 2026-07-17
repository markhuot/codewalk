import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, watch } from "node:fs";
import { join } from "node:path";
import type { Comment, Focus, LineAnchor, LineComment, Reply, ReplySource, Step, Walk } from "./types.ts";

/** Root directory for walk state. Override with CODEWALK_DIR. */
export function stateDir(): string {
  return process.env.CODEWALK_DIR || join(process.cwd(), ".codewalk");
}

function ensureDir(): string {
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function walkPath(id: string): string {
  return join(stateDir(), `${id}.json`);
}

function currentPointerPath(): string {
  return join(stateDir(), "current");
}

let counter = 0;
function makeId(prefix: string): string {
  // Deterministic within a process; unique across processes via time-ish salt
  // derived from the existing files so we never collide with a prior walk.
  counter += 1;
  const salt = readdirSync(ensureDir()).length + counter;
  return `${prefix}-${salt.toString(36)}-${process.pid.toString(36)}`;
}

export function createWalk(title: string): Walk {
  ensureDir();
  const walk: Walk = {
    id: makeId("walk"),
    title,
    createdAt: new Date().toISOString(),
    steps: [],
  };
  saveWalk(walk);
  setCurrent(walk.id);
  return walk;
}

export function saveWalk(walk: Walk): void {
  ensureDir();
  writeFileSync(walkPath(walk.id), JSON.stringify(walk, null, 2));
}

export function loadWalk(id: string): Walk {
  const raw = readFileSync(walkPath(id), "utf8");
  return JSON.parse(raw) as Walk;
}

export function setCurrent(id: string): void {
  ensureDir();
  writeFileSync(currentPointerPath(), id);
}

export function currentId(): string | null {
  const p = currentPointerPath();
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").trim() || null;
}

export function loadCurrent(): Walk {
  const id = currentId();
  if (!id) throw new Error("No active walk. Run `walk start \"<title>\"` first.");
  return loadWalk(id);
}

export function addStep(step: Step): Walk {
  const walk = loadCurrent();
  walk.steps.push(step);
  saveWalk(walk);
  return walk;
}

/** Attach an inline comment to a diff step (by id) in the active walk. */
export function addCommentToStep(stepId: string, comment: Comment): void {
  const walk = loadCurrent();
  const step = walk.steps.find((s) => s.id === stepId);
  if (!step || step.kind !== "diff") return;
  step.comments.push(comment);
  saveWalk(walk);
}

export function nextStepId(walk: Walk, kind: string): string {
  const n = walk.steps.filter((s) => s.kind === kind).length + 1;
  return `${kind}-${n}`;
}

// ── The reply inbox ───────────────────────────────────────────────────────
// Every render target (pane, browser, cli) writes user comments here as JSON
// files. `awaitReply` blocks until the next unconsumed one appears, so the
// human's reply flows back into the agent's conversation as a tool result.

function repliesDir(): string {
  const dir = join(stateDir(), "replies");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function cursorPath(): string {
  return join(stateDir(), "reply-cursor");
}

/** Sortable key so replies read back in the order they were written. */
function replyKey(r: Reply): string {
  return `${r.at}|${r.id}`;
}

export function writeReply(
  text: string,
  opts: { stepId?: string | null; source?: ReplySource; anchor?: LineAnchor; comments?: LineComment[] } = {},
): Reply {
  ensureDir();
  const dir = repliesDir();
  const seq = readdirSync(dir).filter((f) => f.endsWith(".json")).length + 1;
  const reply: Reply = {
    id: `r-${seq}-${process.pid.toString(36)}`,
    at: new Date().toISOString(),
    stepId: opts.stepId ?? null,
    text,
    source: opts.source ?? "cli",
    ...(opts.anchor ? { anchor: opts.anchor } : {}),
    ...(opts.comments && opts.comments.length ? { comments: opts.comments } : {}),
  };
  // Filename is sortable by time so directory order matches chronological order.
  const stamp = reply.at.replace(/[:.]/g, "-");
  writeFileSync(join(dir, `${stamp}_${reply.id}.json`), JSON.stringify(reply, null, 2));
  return reply;
}

export function listReplies(): Reply[] {
  const dir = repliesDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8")) as Reply;
      } catch {
        return null;
      }
    })
    .filter((r): r is Reply => r != null)
    .sort((a, b) => replyKey(a).localeCompare(replyKey(b)));
}

export function repliesForStep(stepId: string): Reply[] {
  return listReplies().filter((r) => r.stepId === stepId);
}

function readCursor(): string {
  const p = cursorPath();
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8").trim();
}

function writeCursor(key: string): void {
  ensureDir();
  writeFileSync(cursorPath(), key);
}

/** The unconsumed replies, oldest first. */
function pendingReplies(): Reply[] {
  const cursor = readCursor();
  return listReplies().filter((r) => replyKey(r) > cursor);
}

/**
 * Block until the next unconsumed reply appears (or the timeout elapses),
 * then advance the cursor past it and return it. Returns null on timeout.
 */
export function awaitReply(timeoutMs?: number): Promise<Reply | null> {
  const immediate = pendingReplies()[0];
  if (immediate) {
    writeCursor(replyKey(immediate));
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (r: Reply | null) => {
      if (done) return;
      done = true;
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
      if (timer) clearTimeout(timer);
      if (r) writeCursor(replyKey(r));
      resolve(r);
    };

    const check = () => {
      const next = pendingReplies()[0];
      if (next) finish(next);
    };

    const watcher = watch(repliesDir(), () => {
      // Debounce lightly: a fresh file may still be mid-write.
      setTimeout(check, 30);
    });
    const timer = timeoutMs != null ? setTimeout(() => finish(null), timeoutMs) : null;
    // Guard against a reply that landed between the immediate check and the watch.
    check();
  });
}

// ── Focus pointer ───────────────────────────────────────────────────────────
// Which step is "on stage", plus a sequence that bumps on every present so a
// live reviewer knows to re-render and re-prompt.

function focusPath(): string {
  return join(stateDir(), "focus.json");
}

export function getFocus(): Focus | null {
  const p = focusPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Focus;
  } catch {
    return null;
  }
}

export function setFocus(stepId: string | null): Focus {
  ensureDir();
  const prev = getFocus();
  const focus: Focus = { stepId, seq: (prev?.seq ?? 0) + 1, at: new Date().toISOString() };
  writeFileSync(focusPath(), JSON.stringify(focus, null, 2));
  return focus;
}

/** Mark the walk complete: reviewers show a done screen and the pane closes. */
export function setFinished(summary?: string): Focus {
  ensureDir();
  const prev = getFocus();
  const focus: Focus = {
    stepId: null, // the walk is over — no step is on stage
    seq: (prev?.seq ?? 0) + 1,
    at: new Date().toISOString(),
    done: true,
    ...(summary ? { summary } : {}),
  };
  writeFileSync(focusPath(), JSON.stringify(focus, null, 2));
  return focus;
}

// ── Render-target pointers ───────────────────────────────────────────────────
// Remember the reviewer pane and the running server between CLI invocations.

function panePath(): string {
  return join(stateDir(), "pane");
}

export function getPaneId(): string | null {
  const p = panePath();
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").trim() || null;
}

export function setPaneId(id: string): void {
  ensureDir();
  writeFileSync(panePath(), id);
}

export function clearPaneId(): void {
  const p = panePath();
  if (existsSync(p)) writeFileSync(p, "");
}

function reviewerPidPath(): string {
  return join(stateDir(), "reviewer.pid");
}

export function setReviewerPid(pid: number): void {
  ensureDir();
  writeFileSync(reviewerPidPath(), String(pid));
}

export function clearReviewerPid(): void {
  const p = reviewerPidPath();
  if (existsSync(p)) writeFileSync(p, "");
}

/** True when a reviewer process wrote its pid and is still alive. */
export function reviewerAlive(): boolean {
  const p = reviewerPidPath();
  if (!existsSync(p)) return false;
  const pid = parseInt(readFileSync(p, "utf8").trim(), 10);
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

function serverPath(): string {
  return join(stateDir(), "server.json");
}

export function getServerInfo(): { port: number; pid: number } | null {
  const p = serverPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as { port: number; pid: number };
  } catch {
    return null;
  }
}

export function setServerInfo(info: { port: number; pid: number }): void {
  ensureDir();
  writeFileSync(serverPath(), JSON.stringify(info));
}

export function clearServerInfo(): void {
  const p = serverPath();
  if (existsSync(p)) writeFileSync(p, "");
}

export function listWalks(): { id: string; title: string; steps: number }[] {
  const dir = stateDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const w = JSON.parse(readFileSync(join(dir, f), "utf8")) as Walk;
        return { id: w.id, title: w.title, steps: w.steps.length };
      } catch {
        return null;
      }
    })
    .filter((x): x is { id: string; title: string; steps: number } => x != null);
}
