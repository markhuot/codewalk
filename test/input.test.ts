import { describe, expect, test } from "bun:test";
import { requireUnifiedDiff } from "../src/diff/input.ts";
import { parseUnifiedDiff } from "../src/diff/parse.ts";

describe("requireUnifiedDiff", () => {
  test("passes a full diff --git through", () => {
    const full = `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b`;
    const f = parseUnifiedDiff(requireUnifiedDiff(full))[0]!;
    expect(f.newPath).toBe("x.ts");
    expect(f.status).toBe("modified");
  });

  test("passes a bare ---/+++ diff through, path and status from the header", () => {
    const added = `--- /dev/null\n+++ b/src/foo.ts\n@@ -0,0 +47,2 @@\n+const a = 1;\n+const b = 2;`;
    const f = parseUnifiedDiff(requireUnifiedDiff(added))[0]!;
    expect(f.status).toBe("added");
    expect(f.newPath).toBe("src/foo.ts");
    // The +47 in the header must survive so the gutter starts at 47.
    expect(f.hunks[0]!.lines[0]).toMatchObject({ type: "add", newNumber: 47 });
  });

  test("rejects a bare @@ hunk and names the header to add", () => {
    expect(() => requireUnifiedDiff("@@ -0,0 +1,1 @@\n+x")).toThrow(/has no path/);
  });

  test("rejects an empty body", () => {
    expect(() => requireUnifiedDiff("   \n  ")).toThrow(/empty/);
  });

  test("rejects a body that is not a diff", () => {
    expect(() => requireUnifiedDiff("just some prose")).toThrow(/unified diff/);
  });
});
