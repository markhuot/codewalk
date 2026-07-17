import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync, watch } from "node:fs";
import { join } from "node:path";
import type { Comment, Focus, LineAnchor, LineComment, Reply, ReplySource, Session, Step } from "./types.ts";

/** Root directory for walk state. Override with CODEWALK_DIR. */
export function stateDir(): string {
  return process.env.CODEWALK_DIR || join(process.cwd(), ".codewalk");
}

function ensureDir(): string {
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionPath(): string {
  return join(stateDir(), "session.json");
}

export function createSession(title: string): Session {
  ensureDir();
  // Start clean: drop any prior walk's replies, cursor, and focus so a fresh
  // walk (or a re-run after editing the code) never shows stale comments.
  resetConversation();
  const session: Session = {
    title,
    createdAt: new Date().toISOString(),
    step: null,
  };
  saveSession(session);
  return session;
}

/** Clear the reply inbox, its cursor, and the focus pointer. */
function resetConversation(): void {
  const dir = stateDir();
  for (const name of ["replies", "reply-cursor", "focus.json"]) {
    try {
      rmSync(join(dir, name), { recursive: true, force: true });
    } catch {
      /* nothing to clear */
    }
  }
}

export function saveSession(session: Session): void {
  ensureDir();
  writeFileSync(sessionPath(), JSON.stringify(session, null, 2));
}

export function loadSession(): Session {
  const p = sessionPath();
  if (!existsSync(p)) throw new Error("No active walk. Run `walk start \"<title>\"` first.");
  return JSON.parse(readFileSync(p, "utf8")) as Session;
}

export function getSession(): Session | null {
  try {
    return loadSession();
  } catch {
    return null;
  }
}

/** Put a step on stage, replacing whatever was there. */
export function setStep(step: Step): Session {
  const session = loadSession();
  session.step = step;
  saveSession(session);
  return session;
}

/** Attach an inline comment to the step currently on stage. */
export function addCommentToCurrentStep(comment: Comment): void {
  const session = loadSession();
  if (!session.step) return;
  session.step.comments.push(comment);
  saveSession(session);
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
  const n = readdirSync(dir).filter((f) => f.endsWith(".json")).length + 1;
  const reply: Reply = {
    id: `r-${n}-${process.pid.toString(36)}`,
    at: new Date().toISOString(),
    // Stamp the focus sequence so the reviewer shows this reply only while its
    // step is on stage; the next present bumps the seq and it drops from view.
    seq: getFocus()?.seq ?? 0,
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

/** Replies left on the step currently on stage (matched by the focus sequence). */
export function currentReplies(): Reply[] {
  const seq = getFocus()?.seq ?? 0;
  return listReplies().filter((r) => r.seq === seq);
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

/** Bump the sequence so a live reviewer re-renders the current step. */
export function setFocus(): Focus {
  ensureDir();
  const prev = getFocus();
  const focus: Focus = { seq: (prev?.seq ?? 0) + 1, at: new Date().toISOString() };
  writeFileSync(focusPath(), JSON.stringify(focus, null, 2));
  return focus;
}

/** Mark the walk complete: reviewers show a done screen and the pane closes. */
export function setFinished(summary?: string): Focus {
  ensureDir();
  const prev = getFocus();
  const focus: Focus = {
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
