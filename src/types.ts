// Shared data model for a "walk": an ordered narration of prose and rendered diffs.

export type DiffLineType = "context" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  /** 1-based line number in the old file, if present on this line. */
  oldNumber?: number;
  /** 1-based line number in the new file, if present on this line. */
  newNumber?: number;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Trailing context on the @@ header line (often the enclosing function). */
  section: string;
  lines: DiffLine[];
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: FileStatus;
  hunks: Hunk[];
  binary: boolean;
  /** Aggregate counts across hunks. */
  additions: number;
  deletions: number;
}

export type CommentSide = "old" | "new";

export interface Comment {
  file: string;
  line: number;
  side: CommentSide;
  body: string;
}

/** A line (or line range) in a diff, used to anchor a click-to-comment reply. */
export interface LineAnchor {
  file: string;
  line: number;
  side: CommentSide;
  /** Set for a click-and-drag selection; the range is line..endLine inclusive. */
  endLine?: number;
}

export interface ProseStep {
  kind: "prose";
  id: string;
  text: string;
}

export interface DiffStep {
  kind: "diff";
  id: string;
  title?: string;
  note?: string;
  files: DiffFile[];
  comments: Comment[];
}

export type Step = ProseStep | DiffStep;

export interface Walk {
  id: string;
  title: string;
  createdAt: string;
  steps: Step[];
}

/** Where a reply came from. */
export type ReplySource = "pane" | "web" | "cli";

/**
 * A message from the human back to the agent. Replies land in the inbox
 * (`.codewalk/replies/`) regardless of render target, and a blocking
 * `walk await` pipes the next unconsumed one back into the conversation.
 */
export interface Reply {
  id: string;
  at: string;
  /** The step the user was looking at when they replied (best-effort). */
  stepId: string | null;
  text: string;
  source: ReplySource;
  /** Set when the reply was left on a specific diff line (click-to-comment). */
  anchor?: LineAnchor;
}

/**
 * The step currently "on stage". `seq` increments on every `present`, which
 * is how a live reviewer (pane or browser) knows the agent advanced and it
 * should re-render and prompt again.
 */
export interface Focus {
  stepId: string | null;
  seq: number;
  at: string;
}
