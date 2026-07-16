// Orchestration for `walk present`: put a step "on stage" for a chosen render
// target, then (optionally) block until the human replies. Every target funnels
// replies into the same inbox, so the blocking `awaitReply` is target-agnostic.

import { spawn } from "node:child_process";
import {
  awaitReply,
  getPaneId,
  getServerInfo,
  loadCurrent,
  reviewerAlive,
  setFocus,
  setPaneId,
  setServerInfo,
  stateDir,
} from "./store.ts";
import { activeDriver, type PaneDriver } from "./panes/index.ts";
import type { Reply, Step } from "./types.ts";

export type RenderTarget = "cli" | "pane" | "web";

export interface PresentOptions {
  render: RenderTarget;
  stepId?: string;
  wait: boolean;
  timeoutSec?: number;
  port: number;
  open: boolean;
}

export interface PresentResult {
  render: RenderTarget;
  step: Step | null;
  reply: Reply | null;
  timedOut: boolean;
  note?: string;
}

/** The current process re-invoked with different args (for spawning helpers). */
function selfArgv(args: string[]): { cmd: string; argv: string[] } {
  const script = process.argv[1] ?? "";
  return { cmd: process.execPath, argv: [script, ...args] };
}

function shquote(s: string): string {
  return /^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function passthroughEnv(): Record<string, string> {
  // FORCE_COLOR lets cli-highlight (chalk) emit color even though it's a child
  // process; CODEWALK_COLOR forces our own renderers on.
  const env: Record<string, string> = { CODEWALK_COLOR: "1", FORCE_COLOR: "3" };
  if (process.env.CODEWALK_DIR) env.CODEWALK_DIR = process.env.CODEWALK_DIR;
  // Carry the light/dark hint into the reviewer pane so its bands match.
  if (process.env.CODEWALK_THEME) env.CODEWALK_THEME = process.env.CODEWALK_THEME;
  if (process.env.COLORFGBG) env.COLORFGBG = process.env.COLORFGBG;
  return env;
}

/** The reviewer command with its environment folded in as a shell prefix, so it
 * runs the same way through any driver (herdr `pane run`, tmux `send-keys`, …). */
function reviewerCommand(): string {
  const env = Object.entries(passthroughEnv())
    .map(([k, v]) => `${k}=${shquote(v)}`)
    .join(" ");
  const { cmd, argv } = selfArgv(["pane"]);
  const bin = [cmd, ...argv].map(shquote).join(" ");
  return env ? `${env} ${bin}` : bin;
}

/** Ensure a reviewer pane exists (via the active driver) and is running. */
function ensurePane(driver: PaneDriver): string {
  // Already have a live reviewer in a live pane? Nothing to do — it will pick
  // up the focus bump on its own.
  const existing = getPaneId();
  if (existing && driver.exists(existing) && reviewerAlive()) return existing;

  // Reuse the pane if it's still open; otherwise split a fresh one.
  let paneId = existing && driver.exists(existing) ? existing : null;
  if (!paneId) {
    paneId = driver.split({ direction: "right", ratio: 0.5, cwd: process.cwd(), focus: false });
    setPaneId(paneId);
    try {
      driver.rename(paneId, "codewalk review");
    } catch {
      /* cosmetic */
    }
  }

  driver.run(paneId, reviewerCommand());
  return paneId;
}

/** Ask the port who it is. Returns the codewalk server's pid, or null if the
 * thing on the port isn't our server (or nothing answers). */
async function serverIdentity(port: number): Promise<number | null> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { codewalk?: boolean; pid?: number };
    return body.codewalk ? body.pid ?? 0 : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureServer(port: number, open: boolean): Promise<string> {
  const url = `http://localhost:${port}`;

  // Reuse only a server we started that's still alive and answering.
  const info = getServerInfo();
  if (info && pidAlive(info.pid) && (await serverIdentity(info.port)) != null) {
    if (open) openBrowser(`http://localhost:${info.port}`);
    return `http://localhost:${info.port}`;
  }

  // If something else already holds the port, don't silently reuse it — a stale
  // or unrelated server would serve the wrong thing. Say so plainly.
  const squatter = await serverIdentity(port);
  if (squatter != null && !(info && squatter === info.pid)) {
    throw new Error(`port ${port} is already serving another codewalk (pid ${squatter}). Run \`walk stop\`, or pass --port.`);
  }
  if (squatter == null && (await fetch(url, { signal: AbortSignal.timeout(400) }).then(() => true).catch(() => false))) {
    throw new Error(`port ${port} is in use by another process. Pass --port to pick a free one.`);
  }

  const { cmd, argv } = selfArgv(["serve", "--port", String(port)]);
  const child = spawn(cmd, argv, { detached: true, stdio: "ignore", env: { ...process.env, ...passthroughEnv() } });
  child.unref();

  // Wait for our server to answer, and confirm it's actually the one we spawned.
  for (let i = 0; i < 40; i++) {
    const pid = await serverIdentity(port);
    if (pid != null && (child.pid == null || pid === child.pid)) {
      setServerInfo({ port, pid });
      if (open) openBrowser(url);
      return url;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server on port ${port} did not come up. Check for errors or pass a different --port.`);
}

function openBrowser(url: string): void {
  try {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* best-effort */
  }
}

export async function present(opts: PresentOptions): Promise<PresentResult> {
  const walk = loadCurrent();
  const stepId = opts.stepId ?? walk.steps[walk.steps.length - 1]?.id ?? null;
  const step = stepId ? walk.steps.find((s) => s.id === stepId) ?? null : null;

  // Bump focus first so any already-running target re-renders immediately.
  setFocus(stepId);

  const timeoutMs = opts.timeoutSec != null ? opts.timeoutSec * 1000 : undefined;

  if (opts.render === "cli") {
    // Inline render: there's no interactive channel, so the reply is simply the
    // user's next chat turn. Never block.
    return { render: "cli", step, reply: null, timedOut: false };
  }

  if (opts.render === "pane") {
    const driver = activeDriver();
    if (!driver) {
      return {
        render: "pane",
        step,
        reply: null,
        timedOut: false,
        note: "No supported multiplexer detected (herdr or tmux) — use --render=web or --render=cli.",
      };
    }
    ensurePane(driver);
  } else if (opts.render === "web") {
    await ensureServer(opts.port, opts.open);
  }

  if (!opts.wait) return { render: opts.render, step, reply: null, timedOut: false };

  const reply = await awaitReply(timeoutMs);
  return { render: opts.render, step, reply, timedOut: reply == null };
}

export { stateDir };
