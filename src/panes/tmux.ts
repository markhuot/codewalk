// tmux pane driver. Maps codewalk's pane operations onto tmux subcommands:
//   split → split-window -P -F '#{pane_id}'   (prints the new pane id, e.g. %5)
//   run   → send-keys -t <id> <command> Enter
//   read  → capture-pane -t <id> -p
//   exists→ display-message -t <id> -p '#{pane_id}'
//   close → kill-pane -t <id>
// The blocking half of codewalk (awaitReply watching the inbox) is unchanged —
// it's multiplexer-agnostic, so tmux support is purely these process calls.

import { spawnSync } from "node:child_process";
import type { PaneDriver, SplitOptions } from "./types.ts";

function tmux(args: string[]): { ok: boolean; out: string } {
  const proc = spawnSync("tmux", args, { encoding: "utf8" });
  return { ok: !proc.error && proc.status === 0, out: (proc.stdout || "").trim() };
}

export const tmuxDriver: PaneDriver = {
  name: "tmux",

  detect() {
    return !!process.env.TMUX;
  },

  split(opts: SplitOptions): string {
    // -h splits side-by-side (new pane to the right), -v stacks it below.
    const args = ["split-window", opts.direction === "down" ? "-v" : "-h", "-P", "-F", "#{pane_id}"];
    if (!opts.focus) args.push("-d"); // -d leaves focus on the current pane
    if (opts.ratio != null) args.push("-l", `${Math.round(opts.ratio * 100)}%`);
    if (opts.cwd) args.push("-c", opts.cwd);
    const res = tmux(args);
    const paneId = res.out.split("\n")[0]?.trim();
    if (!res.ok || !paneId) throw new Error(`tmux split-window failed${res.out ? `: ${res.out}` : ""}`);
    return paneId;
  },

  run(paneId, command) {
    // Send the command as a single literal string, then a separate Enter key.
    const res = tmux(["send-keys", "-t", paneId, command, "Enter"]);
    if (!res.ok) throw new Error("tmux send-keys failed");
  },

  read(paneId, opts = {}) {
    const args = ["capture-pane", "-t", paneId, "-p"];
    if (opts.lines != null) args.push("-S", `-${opts.lines}`);
    const res = tmux(args);
    return res.ok ? res.out : "";
  },

  exists(paneId) {
    return tmux(["display-message", "-t", paneId, "-p", "#{pane_id}"]).ok;
  },

  close(paneId) {
    tmux(["kill-pane", "-t", paneId]);
  },

  rename(paneId, label) {
    // Pane titles (tmux 2.6+); harmless if the option isn't shown anywhere.
    tmux(["select-pane", "-t", paneId, "-T", label]);
  },
};
