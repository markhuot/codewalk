// Thin wrapper over the `herdr` terminal-workspace CLI. herdr is what the user
// runs their agent inside; it exposes a socket API for splitting panes, running
// commands in them, reading their contents, and blocking until output appears.
// Every call shells out to `herdr ... ` and parses the JSON envelope it prints:
//   {"id":"cli:pane:split","result":{ ... },"type":"..."}

import { spawnSync } from "node:child_process";

export interface PaneInfo {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  cwd: string;
}

/** True when we're running inside a herdr session (so panes are available). */
export function inHerdr(): boolean {
  return process.env.HERDR_ENV === "1" && !!process.env.HERDR_SOCKET_PATH;
}

/** The pane the agent itself is running in, if known. */
export function currentPaneId(): string | undefined {
  return process.env.HERDR_PANE_ID || undefined;
}

interface HerdrResult {
  ok: boolean;
  result?: any;
  error?: string;
  raw: string;
}

function herdr(args: string[]): HerdrResult {
  const proc = spawnSync("herdr", args, { encoding: "utf8" });
  if (proc.error) return { ok: false, error: proc.error.message, raw: "" };
  const raw = (proc.stdout || "").trim();
  if (proc.status !== 0) {
    return { ok: false, error: (proc.stderr || raw || `herdr exited ${proc.status}`).trim(), raw };
  }
  try {
    const parsed = JSON.parse(raw);
    // herdr envelopes an error as {"error": {...}} or a bare {"result": ...}.
    if (parsed && parsed.error) return { ok: false, error: JSON.stringify(parsed.error), raw };
    return { ok: true, result: parsed.result ?? parsed, raw };
  } catch {
    // Some commands print plain text; hand it back untouched.
    return { ok: true, result: raw, raw };
  }
}

/**
 * Split a pane and return the new pane's id. `from` is the pane to split off
 * of (defaults to the agent's own pane).
 */
export function splitPane(opts: {
  from?: string;
  direction?: "right" | "down";
  ratio?: number;
  cwd?: string;
  env?: Record<string, string>;
  focus?: boolean;
}): PaneInfo {
  const args = ["pane", "split"];
  if (opts.from) args.push(opts.from);
  else args.push("--current");
  args.push("--direction", opts.direction ?? "right");
  if (opts.ratio != null) args.push("--ratio", String(opts.ratio));
  if (opts.cwd) args.push("--cwd", opts.cwd);
  for (const [k, v] of Object.entries(opts.env ?? {})) args.push("--env", `${k}=${v}`);
  args.push(opts.focus ? "--focus" : "--no-focus");

  const res = herdr(args);
  if (!res.ok) throw new Error(`herdr pane split failed: ${res.error}`);
  const pane = res.result?.pane;
  if (!pane?.pane_id) throw new Error(`herdr pane split returned no pane id: ${res.raw}`);
  return pane as PaneInfo;
}

/** Run a shell command in a pane (types the command and presses Enter). */
export function runInPane(paneId: string, command: string): void {
  const res = herdr(["pane", "run", paneId, command]);
  if (!res.ok) throw new Error(`herdr pane run failed: ${res.error}`);
}

/** Read a pane's contents. */
export function readPane(paneId: string, opts: { source?: "visible" | "recent" | "recent-unwrapped"; lines?: number } = {}): string {
  const args = ["pane", "read", paneId, "--format", "text"];
  if (opts.source) args.push("--source", opts.source);
  if (opts.lines != null) args.push("--lines", String(opts.lines));
  const res = herdr(args);
  if (!res.ok) return "";
  return res.result?.text ?? (typeof res.result === "string" ? res.result : "");
}

/** Whether a pane still exists (the user may have closed it). */
export function paneExists(paneId: string): boolean {
  return herdr(["pane", "get", paneId]).ok;
}

export function closePane(paneId: string): void {
  herdr(["pane", "close", paneId]);
}

export function focusPane(paneId: string): void {
  // `pane focus` is directional; focusing a specific pane by id goes through
  // the agent target resolver, which accepts legacy pane ids. Best-effort.
  herdr(["agent", "focus", paneId]);
}

export function renamePane(paneId: string, label: string): void {
  herdr(["pane", "rename", paneId, label]);
}
