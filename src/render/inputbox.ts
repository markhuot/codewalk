// Lay out the pane's (possibly multi-line) comment input for a fixed-width box,
// tracking where the caret lands. One display row per logical line (split on
// "\n"); the caret's line is windowed horizontally so the caret stays visible,
// and the whole thing is windowed vertically to at most maxRows.

export interface InputLayout {
  rows: string[];
  /** Caret position within `rows` (0-based row, 0-based column). */
  caretRow: number;
  caretCol: number;
}

export function layoutInput(text: string, cursor: number, width: number, maxRows: number): InputLayout {
  width = Math.max(1, width);
  maxRows = Math.max(1, maxRows);
  const logical = text.split("\n");

  // Which logical line and column does the cursor fall on?
  let cRow = 0;
  let cCol = 0;
  let idx = 0;
  for (let i = 0; i < logical.length; i++) {
    const len = logical[i]!.length;
    if (cursor <= idx + len) {
      cRow = i;
      cCol = cursor - idx;
      break;
    }
    idx += len + 1; // + the "\n"
  }

  // Vertical window of at most maxRows lines, keeping the caret line in view.
  let from = 0;
  if (logical.length > maxRows) {
    from = Math.min(Math.max(0, cRow - Math.floor(maxRows / 2)), logical.length - maxRows);
  }
  const visible = logical.slice(from, from + maxRows);

  // Horizontal window: only the caret's line needs to keep the caret visible.
  const rows: string[] = [];
  let caretRow = 0;
  let caretCol = 0;
  visible.forEach((line, i) => {
    const isCaret = from + i === cRow;
    if (line.length <= width) {
      rows.push(line);
      if (isCaret) {
        caretRow = i;
        caretCol = cCol;
      }
      return;
    }
    if (!isCaret) {
      rows.push(line.slice(0, width));
      return;
    }
    const start = cCol > width - 1 ? cCol - width + 1 : 0;
    rows.push(line.slice(start, start + width));
    caretRow = i;
    caretCol = cCol - start;
  });

  return { rows, caretRow, caretCol };
}
