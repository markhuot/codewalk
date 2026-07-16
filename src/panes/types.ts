// A pane driver abstracts one terminal multiplexer (herdr, tmux, …) down to the
// handful of operations codewalk needs: split off a reviewer pane, run the
// reviewer in it, read it back, check it's alive, close it. Adding support for
// another multiplexer is a matter of implementing this interface and
// registering it in ./index.ts — nothing else in the app changes.

export interface SplitOptions {
  cwd?: string;
  direction?: "right" | "down";
  /** Fraction of the split pane the new pane should take (0–1). */
  ratio?: number;
  focus?: boolean;
}

export interface PaneDriver {
  /** Stable id, e.g. "herdr" or "tmux". */
  readonly name: string;
  /** True when this driver's multiplexer is the current environment. */
  detect(): boolean;
  /** Split off a new pane and return its id. */
  split(opts: SplitOptions): string;
  /** Run a shell command in a pane (types it and presses Enter). */
  run(paneId: string, command: string): void;
  /** Read a pane's visible contents (best-effort; "" when unavailable). */
  read(paneId: string, opts?: { lines?: number }): string;
  /** Whether a pane still exists (the user may have closed it). */
  exists(paneId: string): boolean;
  close(paneId: string): void;
  /** Label a pane if the multiplexer supports it; no-op otherwise. */
  rename(paneId: string, label: string): void;
}
