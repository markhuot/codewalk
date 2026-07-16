// herdr pane driver. herdr exposes a socket API; every call shells out to
// `herdr …` and parses the JSON envelope it prints:
//   {"id":"cli:pane:split","result":{ ... },"type":"..."}

import { spawnSync } from "node:child_process";
import type { PaneDriver, SplitOptions } from "./types.ts";

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
    if (parsed && parsed.error) return { ok: false, error: JSON.stringify(parsed.error), raw };
    return { ok: true, result: parsed.result ?? parsed, raw };
  } catch {
    return { ok: true, result: raw, raw };
  }
}

export const herdrDriver: PaneDriver = {
  name: "herdr",

  detect() {
    return process.env.HERDR_ENV === "1" && !!process.env.HERDR_SOCKET_PATH;
  },

  split(opts: SplitOptions): string {
    const args = ["pane", "split", "--current", "--direction", opts.direction ?? "right"];
    if (opts.ratio != null) args.push("--ratio", String(opts.ratio));
    if (opts.cwd) args.push("--cwd", opts.cwd);
    args.push(opts.focus ? "--focus" : "--no-focus");
    const res = herdr(args);
    if (!res.ok) throw new Error(`herdr pane split failed: ${res.error}`);
    const paneId = res.result?.pane?.pane_id;
    if (!paneId) throw new Error(`herdr pane split returned no pane id: ${res.raw}`);
    return paneId as string;
  },

  run(paneId, command) {
    const res = herdr(["pane", "run", paneId, command]);
    if (!res.ok) throw new Error(`herdr pane run failed: ${res.error}`);
  },

  read(paneId, opts = {}) {
    const args = ["pane", "read", paneId, "--format", "text"];
    if (opts.lines != null) args.push("--lines", String(opts.lines));
    const res = herdr(args);
    if (!res.ok) return "";
    return res.result?.text ?? (typeof res.result === "string" ? res.result : "");
  },

  exists(paneId) {
    return herdr(["pane", "get", paneId]).ok;
  },

  close(paneId) {
    herdr(["pane", "close", paneId]);
  },

  rename(paneId, label) {
    herdr(["pane", "rename", paneId, label]);
  },
};
