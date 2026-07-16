// Syntax highlighting for the browser view. highlight.js turns a line of code
// into HTML with `<span class="hljs-...">` tokens (already entity-escaped), which
// a small theme in the page stylesheet colors for light and dark. Shares the
// language detection with the terminal highlighter.

import hljs from "highlight.js";
import { langFor } from "./highlight.ts";

export { langFor };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Highlight one line to safe HTML. Falls back to escaped plain text. */
export function highlightHtml(content: string, lang: string | undefined): string {
  if (!lang || !content.trim()) return esc(content);
  try {
    return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return esc(content);
  }
}
