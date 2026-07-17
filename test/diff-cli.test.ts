import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Drive the real CLI (stdin → authorDiff → parse → persisted session) in a
// throwaway cwd, exercising the merged `present` command: it builds the one step
// from a piped hunk, applies both comment syntaxes, and overwrites on the next call.
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

function loadSession() {
  return JSON.parse(readFileSync(join(dir, ".codewalk", "session.json"), "utf8"));
}

const HUNK = "@@ -0,0 +47,3 @@\n+const a = 1;\n+const b = 2;\n+const c = 3;\n";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "codewalk-cli-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("walk present (stdin + comments)", () => {
  test("builds the step on stage from a piped hunk and both comment syntaxes", () => {
    walk(["start", "test walk"]);
    walk(
      [
        "present", "--render", "cli", "--no-wait",
        "--path", "src/foo.ts",
        "--title", "The thing",
        "--note", "why it matters",
        "--step", "1/3",
        "--comment", "48:string-form comment",
        "--comment:49", "colon-form comment",
        "--comment:47:old", "old-side comment",
      ],
      HUNK,
    );

    const step = loadSession().step;
    expect(step.kind).toBe("diff");
    expect(step.title).toBe("The thing");
    expect(step.progress).toBe("1/3");
    expect(step.files[0].newPath).toBe("src/foo.ts");
    expect(step.files[0].status).toBe("added");

    // All three comments landed, anchored to the --path label.
    expect(step.comments).toHaveLength(3);
    for (const c of step.comments) expect(c.file).toBe("src/foo.ts");
    expect(step.comments).toContainEqual({ file: "src/foo.ts", line: 48, side: "new", body: "string-form comment" });
    expect(step.comments).toContainEqual({ file: "src/foo.ts", line: 49, side: "new", body: "colon-form comment" });
    expect(step.comments).toContainEqual({ file: "src/foo.ts", line: 47, side: "old", body: "old-side comment" });
  });

  test("presenting again overwrites the step — there is no stored backlog", () => {
    walk(["present", "--render", "cli", "--no-wait", "--path", "src/bar.ts", "--title", "Next", "--step", "2/3"], HUNK);
    const step = loadSession().step;
    expect(step.title).toBe("Next");
    expect(step.progress).toBe("2/3");
    expect(step.files[0].newPath).toBe("src/bar.ts");
    // The prior step's comments are gone; this step started clean.
    expect(step.comments).toHaveLength(0);
  });
});
