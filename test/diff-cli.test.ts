import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Drive the real CLI (stdin → authorDiff → parse → persisted walk) in a throwaway
// cwd so we exercise the whole `diff` path, including both comment syntaxes.
const CLI = resolve(import.meta.dir, "../src/cli.ts");
let dir: string;

function walk(args: string[], input?: string) {
  const r = spawnSync("bun", ["run", CLI, ...args], {
    cwd: dir,
    input: input ?? "",
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`walk ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function loadWalk() {
  const codewalk = join(dir, ".codewalk");
  const file = readdirSync(codewalk).find((f) => f.startsWith("walk-") && f.endsWith(".json"))!;
  return JSON.parse(readFileSync(join(codewalk, file), "utf8"));
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "codewalk-cli-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("walk diff (stdin + comments)", () => {
  test("builds a diff step from a piped bare hunk and both comment syntaxes", () => {
    walk(["start", "test walk"]);
    walk(
      [
        "diff",
        "--path", "src/foo.ts",
        "--title", "The thing",
        "--note", "why it matters",
        "--comment", "48:string-form comment",
        "--comment:49", "colon-form comment",
        "--comment:47:old", "old-side comment",
      ],
      "@@ -0,0 +47,3 @@\n+const a = 1;\n+const b = 2;\n+const c = 3;\n",
    );

    const w = loadWalk();
    const step = w.steps.at(-1);
    expect(step.kind).toBe("diff");
    expect(step.files[0].newPath).toBe("src/foo.ts");
    expect(step.files[0].status).toBe("added");

    // All three comments landed, anchored to the --path label.
    expect(step.comments).toHaveLength(3);
    for (const c of step.comments) expect(c.file).toBe("src/foo.ts");
    expect(step.comments).toContainEqual({ file: "src/foo.ts", line: 48, side: "new", body: "string-form comment" });
    expect(step.comments).toContainEqual({ file: "src/foo.ts", line: 49, side: "new", body: "colon-form comment" });
    expect(step.comments).toContainEqual({ file: "src/foo.ts", line: 47, side: "old", body: "old-side comment" });
  });

  test("the standalone comment command derives the file from the step", () => {
    walk(["comment", "48", "a follow-up note"]);
    const step = loadWalk().steps.at(-1);
    expect(step.comments).toContainEqual({ file: "src/foo.ts", line: 48, side: "new", body: "a follow-up note" });
  });
});
