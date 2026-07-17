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

  test("a submission carries an overall message plus staged line comments", async () => {
    const s = await store();
    const comments = [
      { file: "a.ts", line: 10, side: "new" as const, text: "first" },
      { file: "a.ts", line: 20, endLine: 24, side: "new" as const, text: "range one" },
    ];
    s.writeReply("looks good overall", { stepId: "diff-1", source: "web", comments });
    const r = await s.awaitReply(1000);
    expect(r?.text).toBe("looks good overall");
    expect(r?.comments).toHaveLength(2);
    expect(r?.comments?.[1]).toMatchObject({ line: 20, endLine: 24, text: "range one" });
  });

  test("addCommentToCurrentStep appends an inline comment to the step on stage", async () => {
    const s = await store();
    s.createSession("t");
    s.setStep({ kind: "diff", files: [], comments: [] });
    s.addCommentToCurrentStep({ file: "a.ts", line: 9, side: "new", body: "why here?" });
    const step = s.loadSession().step!;
    expect(step.kind).toBe("diff");
    expect(step.comments).toEqual([{ file: "a.ts", line: 9, side: "new", body: "why here?" }]);
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
    expect(s.setFocus().seq).toBe(1);
    expect(s.setFocus().seq).toBe(2);
    expect(s.getFocus()?.seq).toBe(2);
  });
});
