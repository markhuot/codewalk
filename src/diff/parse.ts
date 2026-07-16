import type { DiffFile, DiffLine, FileStatus, Hunk } from "../types.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse a unified diff (as produced by `git diff`, `gh pr diff`, or hand-fed
 * raw input) into a structured list of files. Handles multi-file diffs, added
 * and deleted files, renames, and binary files.
 */
export function parseUnifiedDiff(input: string): DiffFile[] {
  const lines = input.split("\n");
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const pushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const pushFile = () => {
    pushHunk();
    if (current) files.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Start of a new file.
    if (line.startsWith("diff --git ")) {
      pushFile();
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const path = m ? m[1]! : "";
      current = {
        oldPath: path,
        newPath: m ? m[2]! : path,
        status: "modified",
        hunks: [],
        binary: false,
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (!current) {
      // Some tools emit a bare diff with no "diff --git" header (e.g. a raw
      // `diff -u a b`). Bootstrap a file from the ---/+++ markers below.
      if (line.startsWith("--- ")) {
        current = {
          oldPath: stripPathPrefix(line.slice(4)),
          newPath: stripPathPrefix(line.slice(4)),
          status: "modified",
          hunks: [],
          binary: false,
          additions: 0,
          deletions: 0,
        };
      } else {
        continue;
      }
    }

    if (line.startsWith("new file mode")) {
      current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = line.slice("rename from ".length);
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.newPath = line.slice("rename to ".length);
      continue;
    }
    if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      const p = stripPathPrefix(line.slice(4));
      if (p !== "/dev/null") current.oldPath = p;
      else current.status = "added";
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = stripPathPrefix(line.slice(4));
      if (p !== "/dev/null") current.newPath = p;
      else current.status = "deleted";
      continue;
    }
    if (line.startsWith("index ") || line.startsWith("similarity index") ||
        line.startsWith("old mode") || line.startsWith("new mode") ||
        line.startsWith("copy from") || line.startsWith("copy to")) {
      continue;
    }

    const hm = line.match(HUNK_HEADER);
    if (hm) {
      pushHunk();
      oldLine = parseInt(hm[1]!, 10);
      newLine = parseInt(hm[3]!, 10);
      hunk = {
        oldStart: oldLine,
        oldLines: hm[2] ? parseInt(hm[2], 10) : 1,
        newStart: newLine,
        newLines: hm[4] ? parseInt(hm[4], 10) : 1,
        section: (hm[5] ?? "").trim(),
        lines: [],
      };
      continue;
    }

    if (!hunk) continue;

    // "\ No newline at end of file" is metadata, not content.
    if (line.startsWith("\\")) continue;

    const marker = line[0];
    const content = line.slice(1);
    let entry: DiffLine;
    if (marker === "+") {
      entry = { type: "add", content, newNumber: newLine++ };
      current.additions++;
    } else if (marker === "-") {
      entry = { type: "del", content, oldNumber: oldLine++ };
      current.deletions++;
    } else {
      // Context line (leading space) or an empty line in the diff body.
      entry = { type: "context", content, oldNumber: oldLine++, newNumber: newLine++ };
    }
    hunk.lines.push(entry);
  }

  pushFile();
  return files;
}

function stripPathPrefix(raw: string): string {
  const p = raw.trim().replace(/\t.*$/, "");
  if (p === "/dev/null") return p;
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}
