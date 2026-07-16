import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test gets a throwaway CODEWALK_DIR so the inbox/cursor/focus state is
// isolated. The store reads CODEWALK_DIR lazily, so setting it per-test works.
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codewalk-"));
  process.env.CODEWALK_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CODEWALK_DIR;
});

async function store() {
  // Fresh import each test file run; the module is stateless w.r.t. the dir.
  return await import("../src/store.ts");
}

describe("reply inbox", () => {
  test("writes and lists replies in chronological order", async () => {
    const s = await store();
    s.writeReply("first", { stepId: "diff-1", source: "pane" });
    s.writeReply("second", { stepId: "diff-1", source: "web" });
    const all = s.listReplies();
    expect(all.map((r) => r.text)).toEqual(["first", "second"]);
    expect(all[0]!.source).toBe("pane");
    expect(all[1]!.source).toBe("web");
  });

  test("repliesForStep filters by step id", async () => {
    const s = await store();
    s.writeReply("on one", { stepId: "diff-1" });
    s.writeReply("on two", { stepId: "diff-2" });
    expect(s.repliesForStep("diff-1").map((r) => r.text)).toEqual(["on one"]);
    expect(s.repliesForStep("diff-2").map((r) => r.text)).toEqual(["on two"]);
  });

  test("awaitReply returns the pending reply and advances the cursor", async () => {
    const s = await store();
    s.writeReply("hello");
    const first = await s.awaitReply(1000);
    expect(first?.text).toBe("hello");
    // Cursor advanced: no more pending, so a short timeout returns null.
    const second = await s.awaitReply(150);
    expect(second).toBeNull();
  });

  test("awaitReply blocks until a reply arrives", async () => {
    const s = await store();
    const pending = s.awaitReply(2000);
    setTimeout(() => s.writeReply("late arrival", { source: "web" }), 120);
    const reply = await pending;
    expect(reply?.text).toBe("late arrival");
  });

  test("consecutive awaits drain replies one at a time in order", async () => {
    const s = await store();
    s.writeReply("a");
    s.writeReply("b");
    expect((await s.awaitReply(500))?.text).toBe("a");
    expect((await s.awaitReply(500))?.text).toBe("b");
    expect(await s.awaitReply(120)).toBeNull();
  });
});

describe("click-to-comment", () => {
  test("writeReply carries a line anchor", async () => {
    const s = await store();
    const anchor = { file: "src/foo.ts", line: 42, side: "new" as const };
    s.writeReply("this line is the interesting part", { stepId: "diff-1", source: "pane", anchor });
    const r = s.listReplies()[0]!;
    expect(r.anchor).toEqual(anchor);
  });

  test("awaitReply preserves the anchor through the inbox", async () => {
    const s = await store();
    s.writeReply("anchored", { stepId: "diff-1", source: "pane", anchor: { file: "a.ts", line: 3, side: "old" } });
    const r = await s.awaitReply(1000);
    expect(r?.anchor).toEqual({ file: "a.ts", line: 3, side: "old" });
  });

  test("addCommentToStep appends an inline comment to a diff step", async () => {
    const s = await store();
    const walk = s.createWalk("t");
    s.addStep({ kind: "diff", id: "diff-1", files: [], comments: [] });
    s.addCommentToStep("diff-1", { file: "a.ts", line: 9, side: "new", body: "why here?" });
    const reloaded = s.loadWalk(walk.id);
    const step = reloaded.steps.find((x) => x.id === "diff-1")!;
    expect(step.kind).toBe("diff");
    expect((step as any).comments).toEqual([{ file: "a.ts", line: 9, side: "new", body: "why here?" }]);
  });
});

describe("syntax highlighting language detection", () => {
  test("maps common extensions and rejects unknown ones", async () => {
    const { langFor } = await import("../src/render/highlight.ts");
    expect(langFor("src/foo.ts")).toBe("typescript");
    expect(langFor("a/b/style.css")).toBe("css");
    expect(langFor("Dockerfile")).toBe("dockerfile");
    expect(langFor("data.bin")).toBeUndefined();
    expect(langFor("noext")).toBeUndefined();
  });
});

describe("focus pointer", () => {
  test("setFocus bumps the sequence on every present", async () => {
    const s = await store();
    expect(s.getFocus()).toBeNull();
    const f1 = s.setFocus("diff-1");
    expect(f1.seq).toBe(1);
    expect(f1.stepId).toBe("diff-1");
    const f2 = s.setFocus("diff-2");
    expect(f2.seq).toBe(2);
    expect(s.getFocus()?.stepId).toBe("diff-2");
  });
});
