import { describe, expect, test } from "bun:test";
import { authorDiff } from "../src/diff/author.ts";
import { parseUnifiedDiff } from "../src/diff/parse.ts";

describe("authorDiff", () => {
  test("wraps a bare new-file hunk as an added file with correct gutter numbers", () => {
    const raw = authorDiff("src/foo.ts", "@@ -0,0 +47,3 @@\n+const a = 1;\n+const b = 2;\n+const c = 3;");
    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    const f = files[0]!;
    expect(f.status).toBe("added");
    expect(f.newPath).toBe("src/foo.ts");
    expect(f.additions).toBe(3);
    // The hunk header's +47 must survive so the gutter starts at 47, not 1.
    expect(f.hunks[0]!.lines[0]).toMatchObject({ type: "add", newNumber: 47 });
    expect(f.hunks[0]!.lines[2]).toMatchObject({ type: "add", newNumber: 49 });
  });

  test("infers a modified file from a mixed hunk", () => {
    const raw = authorDiff("a.ts", "@@ -10,3 +10,3 @@\n ctx\n-old line\n+new line");
    const f = parseUnifiedDiff(raw)[0]!;
    expect(f.status).toBe("modified");
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
  });

  test("infers a deleted file when every hunk removes to nothing", () => {
    const raw = authorDiff("gone.ts", "@@ -1,2 +0,0 @@\n-line one\n-line two");
    const f = parseUnifiedDiff(raw)[0]!;
    expect(f.status).toBe("deleted");
    expect(f.deletions).toBe(2);
  });

  test("passes a full diff --git through untouched (path from the diff)", () => {
    const full = `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b`;
    const f = parseUnifiedDiff(authorDiff("ignored-label", full))[0]!;
    expect(f.newPath).toBe("x.ts");
    expect(f.status).toBe("modified");
  });

  test("rejects an empty body", () => {
    expect(() => authorDiff("a.ts", "   \n  ")).toThrow(/empty/);
  });

  test("rejects a body that is not a hunk", () => {
    expect(() => authorDiff("a.ts", "just some prose")).toThrow(/hunk header/);
  });

  test("requires --path for a bare hunk", () => {
    expect(() => authorDiff("", "@@ -0,0 +1,1 @@\n+x")).toThrow(/--path is required/);
  });
});
