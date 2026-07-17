// A tiny text-and-cursor model for the pane's comment input. Pure functions so
// the editing behavior (word motion, word delete, newline insertion) is unit
// tested; pane.ts holds one Edit in its state and applies these on keypresses.

export interface Edit {
  text: string;
  cursor: number;
}

const isWS = (ch: string | undefined) => ch != null && /\s/.test(ch);

export function insert(e: Edit, s: string): Edit {
  return { text: e.text.slice(0, e.cursor) + s + e.text.slice(e.cursor), cursor: e.cursor + s.length };
}

/** Delete the character before the cursor. */
export function backspace(e: Edit): Edit {
  if (e.cursor === 0) return e;
  return { text: e.text.slice(0, e.cursor - 1) + e.text.slice(e.cursor), cursor: e.cursor - 1 };
}

export function left(e: Edit): Edit {
  return e.cursor === 0 ? e : { ...e, cursor: e.cursor - 1 };
}

export function right(e: Edit): Edit {
  return e.cursor >= e.text.length ? e : { ...e, cursor: e.cursor + 1 };
}

/** Index of the previous word start: skip whitespace left, then the word. */
export function prevWord(text: string, i: number): number {
  let j = i;
  while (j > 0 && isWS(text[j - 1])) j--;
  while (j > 0 && !isWS(text[j - 1])) j--;
  return j;
}

/** Index just after the next word: skip whitespace right, then the word. */
export function nextWord(text: string, i: number): number {
  let j = i;
  const n = text.length;
  while (j < n && isWS(text[j])) j++;
  while (j < n && !isWS(text[j])) j++;
  return j;
}

export function wordLeft(e: Edit): Edit {
  return { ...e, cursor: prevWord(e.text, e.cursor) };
}

export function wordRight(e: Edit): Edit {
  return { ...e, cursor: nextWord(e.text, e.cursor) };
}

/** Delete from the previous word boundary up to the cursor. */
export function deleteWord(e: Edit): Edit {
  const start = prevWord(e.text, e.cursor);
  if (start === e.cursor) return e;
  return { text: e.text.slice(0, start) + e.text.slice(e.cursor), cursor: start };
}

/** Move to the start of the current line (just after the previous newline). */
export function lineStart(e: Edit): Edit {
  return { ...e, cursor: e.text.lastIndexOf("\n", e.cursor - 1) + 1 };
}

/** Move to the end of the current line (just before the next newline). */
export function lineEnd(e: Edit): Edit {
  const nl = e.text.indexOf("\n", e.cursor);
  return { ...e, cursor: nl === -1 ? e.text.length : nl };
}
