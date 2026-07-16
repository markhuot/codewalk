import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "../src/diff/parse.ts";

describe("parseUnifiedDiff", () => {
  test("parses a simple modification with correct line numbers", () => {
    const diff = `diff --git a/src/greet.ts b/src/greet.ts
index 111..222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,3 @@ export function greet
 const name = "world";
-console.log("hi " + name);
+console.log("hello " + name);
 export {};`;
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    const f = files[0]!;
    expect(f.status).toBe("modified");
    expect(f.newPath).toBe("src/greet.ts");
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
    expect(f.hunks[0]!.section).toBe("export function greet");

    const lines = f.hunks[0]!.lines;
    expect(lines[0]).toMatchObject({ type: "context", oldNumber: 1, newNumber: 1 });
    expect(lines[1]).toMatchObject({ type: "del", oldNumber: 2, content: 'console.log("hi " + name);' });
    expect(lines[2]).toMatchObject({ type: "add", newNumber: 2, content: 'console.log("hello " + name);' });
    expect(lines[3]).toMatchObject({ type: "context", oldNumber: 3, newNumber: 3 });
  });

  test("detects added files (/dev/null old side)", () => {
    const diff = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..abc
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+line one
+line two`;
    const f = parseUnifiedDiff(diff)[0]!;
    expect(f.status).toBe("added");
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(0);
    expect(f.hunks[0]!.lines.map((l) => l.newNumber)).toEqual([1, 2]);
  });

  test("detects deleted files", () => {
    const diff = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index abc..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-bye`;
    const f = parseUnifiedDiff(diff)[0]!;
    expect(f.status).toBe("deleted");
    expect(f.deletions).toBe(1);
  });

  test("detects renames", () => {
    const diff = `diff --git a/old/path.ts b/new/path.ts
similarity index 90%
rename from old/path.ts
rename to new/path.ts
index abc..def 100644
--- a/old/path.ts
+++ b/new/path.ts
@@ -1,1 +1,1 @@
-const a = 1;
+const a = 2;`;
    const f = parseUnifiedDiff(diff)[0]!;
    expect(f.status).toBe("renamed");
    expect(f.oldPath).toBe("old/path.ts");
    expect(f.newPath).toBe("new/path.ts");
  });

  test("handles multiple files in one diff", () => {
    const diff = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+A
diff --git a/b.txt b/b.txt
--- a/b.txt
+++ b/b.txt
@@ -1 +1 @@
-b
+B`;
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => f.newPath)).toEqual(["a.txt", "b.txt"]);
  });

  test("flags binary files", () => {
    const diff = `diff --git a/img.png b/img.png
index abc..def 100644
Binary files a/img.png and b/img.png differ`;
    const f = parseUnifiedDiff(diff)[0]!;
    expect(f.binary).toBe(true);
  });

  test("handles multi-hunk files and hunk section headers", () => {
    const diff = `diff --git a/multi.ts b/multi.ts
--- a/multi.ts
+++ b/multi.ts
@@ -1,2 +1,2 @@ function top()
 a
-b
+B
@@ -10,2 +10,3 @@ function bottom()
 x
+y
 z`;
    const f = parseUnifiedDiff(diff)[0]!;
    expect(f.hunks).toHaveLength(2);
    expect(f.hunks[1]!.section).toBe("function bottom()");
    expect(f.hunks[1]!.newStart).toBe(10);
    expect(f.additions).toBe(2);
  });
});
