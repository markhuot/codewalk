// codewalk renders a diff; it doesn't fetch or synthesize one. The caller
// produces a unified diff however they like (a local git/gh command, an API
// pull from a repo that was never cloned, or a hunk authored by hand for a
// change that doesn't exist yet) and pipes it in. The diff always carries its
// own path in the ---/+++ header, so there is one input shape and no --path.

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Validate that the piped body is a unified diff and return it for the parser.
 * A bare `@@` hunk has no path, so it's rejected with the header to add.
 */
export function requireUnifiedDiff(body: string): string {
  const trimmed = body.replace(/^[\r\n]+/, "").replace(/\s+$/, "");
  if (!trimmed) {
    throw new Error("diff body is empty — pipe a unified diff on stdin.");
  }
  if (trimmed.startsWith("diff --git ") || trimmed.startsWith("--- ")) {
    return trimmed + "\n";
  }
  if (trimmed.startsWith("@@")) {
    throw new Error(
      'a bare "@@" hunk has no path — prefix it with a header, e.g.\n' +
        "  --- /dev/null\n" +
        "  +++ b/<path>\n" +
        "  @@ -0,0 +47,3 @@\n" +
        "  +...\n" +
        "(use --- a/<path> for an edit, or +++ /dev/null for a deletion)",
    );
  }
  throw new Error('stdin must be a unified diff (it starts with "diff --git" or "---").');
}
