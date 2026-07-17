// Ways to obtain a unified diff: local git, a GitHub PR via `gh`, or raw input.

import { spawnSync } from "node:child_process";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

export interface DiffSourceOptions {
  staged?: boolean;
  from?: string;
  to?: string;
  pr?: string;
  files?: string[];
  stdin?: boolean;
  raw?: string;
  /** Lines of context around each change (git -U). Defaults to git's default of 3. */
  context?: number;
}

function exec(cmd: string[]): { status: number; stdout: string; stderr: string } {
  const proc = spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: proc.status ?? 1, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

function run(cmd: string[]): string {
  const proc = exec(cmd);
  if (proc.status !== 0) {
    const err = proc.stderr.trim() || proc.stdout.trim();
    throw new Error(`\`${cmd.join(" ")}\` failed (exit ${proc.status}): ${err}`);
  }
  return proc.stdout;
}

// `git diff --no-index` reports "differences found" with exit code 1, which is
// success for our purposes. Tolerate 0 and 1; anything else is a real error.
function runDiff(cmd: string[]): string {
  const proc = exec(cmd);
  if (proc.status !== 0 && proc.status !== 1) {
    const err = proc.stderr.trim() || proc.stdout.trim();
    throw new Error(`\`${cmd.join(" ")}\` failed (exit ${proc.status}): ${err}`);
  }
  return proc.stdout;
}

/**
 * Untracked files never appear in `git diff`, so a walk of brand-new work would
 * silently miss them. Synthesize an added-file diff for each (optionally scoped
 * to --files) with a read-only `--no-index` against /dev/null.
 */
function untrackedDiff(files?: string[], context?: number): string {
  let list: string[];
  try {
    list = run(["git", "ls-files", "--others", "--exclude-standard"])
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return "";
  }
  if (files && files.length) list = list.filter((f) => files.includes(f));
  const ctx = context != null ? [`-U${context}`] : [];
  return list
    .map((f) => runDiff(["git", "diff", "--no-color", "--no-ext-diff", ...ctx, "--no-index", "--", "/dev/null", f]))
    .join("");
}

/** Resolve a raw unified diff string from the requested source. */
export async function resolveDiff(opts: DiffSourceOptions): Promise<string> {
  if (opts.raw != null) return opts.raw;

  if (opts.stdin) {
    return await readStdin();
  }

  if (opts.pr) {
    // `gh pr diff` prints a unified diff for the PR.
    return run(["gh", "pr", "diff", opts.pr]);
  }

  const cmd = ["git", "diff", "--no-color", "--no-ext-diff"];
  if (opts.context != null) cmd.push(`-U${opts.context}`);
  if (opts.staged) cmd.push("--cached");
  if (opts.from && opts.to) cmd.push(`${opts.from}..${opts.to}`);
  else if (opts.from) cmd.push(opts.from);
  if (opts.files && opts.files.length) cmd.push("--", ...opts.files);
  let out = run(cmd);

  // When the diff touches the working tree (no --cached, no commit range),
  // fold in untracked files so new work shows up.
  const worksWorkingTree = !opts.staged && !opts.to;
  if (worksWorkingTree) out += untrackedDiff(opts.files, opts.context);
  return out;
}
