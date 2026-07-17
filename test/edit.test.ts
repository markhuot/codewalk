import { describe, expect, test } from "bun:test";
import { backspace, deleteWord, insert, left, nextWord, prevWord, right, wordLeft, wordRight } from "../src/edit.ts";
import { layoutInput } from "../src/render/inputbox.ts";

describe("edit: insert and delete at the cursor", () => {
  test("insert splices at the cursor and advances it", () => {
    expect(insert({ text: "ac", cursor: 1 }, "b")).toEqual({ text: "abc", cursor: 2 });
  });

  test("insert can add a newline", () => {
    expect(insert({ text: "ab", cursor: 1 }, "\n")).toEqual({ text: "a\nb", cursor: 2 });
  });

  test("backspace removes the char before the cursor", () => {
    expect(backspace({ text: "abc", cursor: 2 })).toEqual({ text: "ac", cursor: 1 });
    expect(backspace({ text: "abc", cursor: 0 })).toEqual({ text: "abc", cursor: 0 });
  });
});

describe("edit: word motion (to the next whitespace)", () => {
  const text = "the quick  brown";
  test("nextWord lands after the current word", () => {
    expect(nextWord(text, 0)).toBe(3); // after "the"
    expect(nextWord(text, 3)).toBe(9); // skip space, after "quick"
    expect(nextWord(text, 16)).toBe(16); // at end, stays
  });
  test("prevWord lands at the start of the previous word", () => {
    expect(prevWord(text, 16)).toBe(11); // start of "brown"
    expect(prevWord(text, 9)).toBe(4); // start of "quick"
    expect(prevWord(text, 0)).toBe(0); // at start, stays
  });
  test("wordLeft/wordRight move the cursor by a word", () => {
    expect(wordRight({ text, cursor: 0 }).cursor).toBe(3);
    expect(wordLeft({ text, cursor: 16 }).cursor).toBe(11);
  });
  test("word motion treats newlines as whitespace", () => {
    expect(nextWord("a\nb", 0)).toBe(1);
    expect(prevWord("a\nb", 3)).toBe(2);
  });
});

describe("edit: deleteWord", () => {
  test("removes the word before the cursor", () => {
    expect(deleteWord({ text: "foo bar", cursor: 7 })).toEqual({ text: "foo ", cursor: 4 });
  });
  test("removes trailing whitespace plus the word", () => {
    expect(deleteWord({ text: "foo bar  ", cursor: 9 })).toEqual({ text: "foo ", cursor: 4 });
  });
  test("no-op at the start", () => {
    expect(deleteWord({ text: "foo", cursor: 0 })).toEqual({ text: "foo", cursor: 0 });
  });
  test("only deletes back to the cursor, not past it", () => {
    expect(deleteWord({ text: "foo bar baz", cursor: 7 })).toEqual({ text: "foo  baz", cursor: 4 });
  });
});

describe("layoutInput", () => {
  test("splits on newlines into rows with the caret placed", () => {
    const l = layoutInput("first\nsecond", 8, 40, 8); // cursor at "sec|ond" → row 1, col 2
    expect(l.rows).toEqual(["first", "second"]);
    expect(l.caretRow).toBe(1);
    expect(l.caretCol).toBe(2);
  });

  test("caret at the very end sits after the last char", () => {
    const l = layoutInput("ab\ncd", 5, 40, 8);
    expect(l.caretRow).toBe(1);
    expect(l.caretCol).toBe(2);
  });

  test("windows a long caret line horizontally so the caret stays visible", () => {
    const line = "0123456789abcdef"; // len 16
    const l = layoutInput(line, 16, 10, 8); // cursor at end
    expect(l.rows[0]!.length).toBeLessThanOrEqual(10);
    expect(l.rows[0]!.endsWith("f")).toBe(true); // the tail (with the caret) is shown
    expect(l.caretCol).toBeGreaterThan(0);
    expect(l.caretCol).toBeLessThanOrEqual(10);
  });

  test("windows vertically to maxRows around the caret", () => {
    const text = Array.from({ length: 12 }, (_, i) => `line${i}`).join("\n");
    const cursor = text.length; // last line
    const l = layoutInput(text, cursor, 40, 4);
    expect(l.rows).toHaveLength(4);
    expect(l.rows.at(-1)).toBe("line11");
  });
});
