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
import { inHerdr, paneExists, runInPane, splitPane, renamePane } from "./herdr.ts";
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
  return env;
}

/** Ensure a reviewer pane exists and is running the reviewer loop. */
function ensurePane(): string {
  // Already have a live reviewer in a live pane? Nothing to do — it will pick
  // up the focus bump on its own.
  const existing = getPaneId();
  if (existing && paneExists(existing) && reviewerAlive()) return existing;

  // Reuse the pane if it's still open; otherwise split a fresh one.
  let paneId = existing && paneExists(existing) ? existing : null;
  if (!paneId) {
    const info = splitPane({
      direction: "right",
      ratio: 0.5,
      cwd: process.cwd(),
      env: passthroughEnv(),
      focus: false,
    });
    paneId = info.pane_id;
    setPaneId(paneId);
    try {
      renamePane(paneId, "codewalk review");
    } catch {
      /* cosmetic */
    }
  }

  const { cmd, argv } = selfArgv(["pane"]);
  runInPane(paneId, [cmd, ...argv].map(shquote).join(" "));
  return paneId;
}

/** Ping the server's port; true if something answers. */
async function serverResponds(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/walk`, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

async function ensureServer(port: number, open: boolean): Promise<string> {
  const url = `http://localhost:${port}`;
  const info = getServerInfo();
  const alive = info && (await serverResponds(info.port));
  if (alive) {
    if (open) openBrowser(`http://localhost:${info!.port}`);
    return `http://localhost:${info!.port}`;
  }

  const { cmd, argv } = selfArgv(["serve", "--port", String(port)]);
  const child = spawn(cmd, argv, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...passthroughEnv() },
  });
  child.unref();
  setServerInfo({ port, pid: child.pid ?? 0 });

  // Wait for it to accept connections before we tell the browser to load.
  for (let i = 0; i < 40; i++) {
    if (await serverResponds(port)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (open) openBrowser(url);
  return url;
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
    if (!inHerdr()) {
      return {
        render: "pane",
        step,
        reply: null,
        timedOut: false,
        note: "Not inside a herdr session — use --render=web or --render=cli.",
      };
    }
    ensurePane();
  } else if (opts.render === "web") {
    await ensureServer(opts.port, opts.open);
  }

  if (!opts.wait) return { render: opts.render, step, reply: null, timedOut: false };

  const reply = await awaitReply(timeoutMs);
  return { render: opts.render, step, reply, timedOut: reply == null };
}

export { stateDir };
