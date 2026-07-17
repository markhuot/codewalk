// A codewalk step is handed its diff directly — codewalk no longer fetches from
// git or gh. The agent produces a unified hunk however it likes (authored by
// hand for a change that doesn't exist yet, or pulled from any tool/API) and
// pipes it in. This module reads that content and, for a bare hunk, wraps it in
// the minimal file envelope the parser needs so the caller never has to write
// `diff --git` / `---` / `+++` lines by hand.

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/gm;

/**
 * Turn the diff body a caller piped in into a full unified diff ready for the
 * parser.
 *
 * Two accepted inputs:
 *  - A **full file diff** (starts with `diff --git` or `---`) — used verbatim;
 *    the path comes from the diff itself and `--path` is not needed.
 *  - One or more **bare hunks** (starts with `@@`) — the common case. We
 *    synthesize the `diff --git` / `---` / `+++` envelope from `path`, inferring
 *    whether the file is added / deleted / modified from the hunk headers, so a
 *    real `@@ -0,0 +47,19 @@` renders with the right gutter numbers and status.
 *
 * The path is a label, not a file on disk: it can name a file that doesn't
 * exist yet (a planned change) or a file in a repo that was never cloned.
 */
export function authorDiff(path: string, body: string): string {
  const trimmed = body.replace(/^[\r\n]+/, "").replace(/\s+$/, "");
  if (!trimmed) {
    throw new Error("diff body is empty — pipe a unified hunk on stdin.");
  }

  // A full file diff (from a tool, or hand-authored with headers) is used as-is.
  if (trimmed.startsWith("diff --git ") || trimmed.startsWith("--- ")) {
    return trimmed + "\n";
  }

  if (!trimmed.startsWith("@@")) {
    throw new Error(
      'diff body must start with a hunk header ("@@ -a,b +c,d @@") or be a full file diff.',
    );
  }
  if (!path) {
    throw new Error("--path is required when piping a bare hunk.");
  }

  const headers = [...trimmed.matchAll(HUNK_HEADER)];
  if (headers.length === 0) {
    throw new Error('no valid hunk header ("@@ -a,b +c,d @@") found in the diff body.');
  }
  // A missing count in a hunk header means 1 (e.g. `@@ -0,0 +5 @@`).
  const oldCount = (h: RegExpMatchArray) => (h[1] != null ? parseInt(h[1], 10) : 1);
  const newCount = (h: RegExpMatchArray) => (h[2] != null ? parseInt(h[2], 10) : 1);
  const added = headers.every((h) => oldCount(h) === 0);
  const deleted = headers.every((h) => newCount(h) === 0);

  const out = [`diff --git a/${path} b/${path}`];
  if (added) out.push("new file mode 100644");
  else if (deleted) out.push("deleted file mode 100644");
  out.push(`--- ${added ? "/dev/null" : `a/${path}`}`);
  out.push(`+++ ${deleted ? "/dev/null" : `b/${path}`}`);
  out.push(trimmed);
  return out.join("\n") + "\n";
}
