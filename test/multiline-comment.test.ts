import { describe, expect, test } from "bun:test";
import { buildContentRows } from "../src/render/rows.ts";
import { renderStep } from "../src/render/terminal.ts";
import { renderFragment } from "../src/render/html.ts";
import type { Session, Step } from "../src/types.ts";

// A comment whose body carries a newline should render across multiple lines in
// every target, not get flattened to one line.
const step: Step = {
  kind: "diff",
  files: [
    {
      oldPath: "x.ts",
      newPath: "x.ts",
      status: "added",
      binary: false,
      additions: 1,
      deletions: 0,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, section: "", lines: [{ type: "add", content: "const a = 1;", newNumber: 1 }] }],
    },
  ],
  comments: [{ file: "x.ts", line: 1, side: "new", body: "first line\nsecond line" }],
};

describe("multiline comment bodies", () => {
  test("the pane renderer keeps the line break", () => {
    const text = buildContentRows(step, [], 80).map((r) => r.ansi).join("\n");
    expect(text).toContain("first line");
    expect(text).toContain("second line");
    // Not flattened onto one line.
    expect(text).not.toContain("first line second line");
  });

  test("the terminal renderer keeps the line break", () => {
    const text = renderStep(step, { width: 80 });
    expect(text).toContain("first line");
    expect(text).toContain("second line");
    expect(text).not.toContain("first line second line");
  });

  test("the browser fragment preserves it with pre-wrap and a real newline", () => {
    const session: Session = { title: "t", createdAt: "", step };
    const html = renderFragment(session, { focus: { seq: 1, at: "" } });
    expect(html).toContain("comment-body");
    expect(html).toContain("first line\nsecond line");
  });
});
