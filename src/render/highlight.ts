// Syntax highlighting for terminal diffs. cli-highlight emits foreground-only
// SGR colors that close with \x1b[39m (never a full \x1b[0m reset and never a
// background code), so highlighted text composes cleanly over a diff's
// background band — the band survives until we reset it ourselves at line end.

import { highlight, supportsLanguage } from "cli-highlight";

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "xml",
  vue: "xml",
  svelte: "xml",
  xml: "xml",
  py: "python",
  rb: "ruby",
  php: "php",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  lua: "lua",
  ex: "elixir",
  exs: "elixir",
};

/** Best-effort language id for a path, or undefined when we shouldn't highlight. */
export function langFor(path: string): string | undefined {
  const base = path.split("/").pop() ?? path;
  if (/^dockerfile$/i.test(base)) return "dockerfile";
  if (/^makefile$/i.test(base)) return "makefile";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  const lang = EXT_LANG[ext];
  if (!lang) return undefined;
  return supportsLanguage(lang) ? lang : undefined;
}

/**
 * Highlight a single (already width-clipped) line of code. Highlighting each
 * line independently loses cross-line context (block comments, template
 * literals), but it's fast, cache-free, and good enough for a diff view.
 * Returns the input unchanged when highlighting is unavailable or errors.
 */
export function highlightLine(content: string, lang: string | undefined): string {
  if (!lang || !content.trim()) return content;
  try {
    return highlight(content, { language: lang, ignoreIllegals: true });
  } catch {
    return content;
  }
}
