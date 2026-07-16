// Ways to obtain a unified diff: local git, a GitHub PR via `gh`, or raw input.

export interface DiffSourceOptions {
  staged?: boolean;
  from?: string;
  to?: string;
  pr?: string;
  files?: string[];
  stdin?: boolean;
  raw?: string;
}

function run(cmd: string[]): string {
  const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    const err = proc.stderr.toString().trim() || proc.stdout.toString().trim();
    throw new Error(`\`${cmd.join(" ")}\` failed (exit ${proc.exitCode}): ${err}`);
  }
  return proc.stdout.toString();
}

/** Resolve a raw unified diff string from the requested source. */
export async function resolveDiff(opts: DiffSourceOptions): Promise<string> {
  if (opts.raw != null) return opts.raw;

  if (opts.stdin) {
    return await Bun.stdin.text();
  }

  if (opts.pr) {
    // `gh pr diff` prints a unified diff for the PR.
    return run(["gh", "pr", "diff", opts.pr]);
  }

  const cmd = ["git", "diff", "--no-color", "--no-ext-diff"];
  if (opts.staged) cmd.push("--cached");
  if (opts.from && opts.to) cmd.push(`${opts.from}..${opts.to}`);
  else if (opts.from) cmd.push(opts.from);
  if (opts.files && opts.files.length) cmd.push("--", ...opts.files);
  return run(cmd);
}
