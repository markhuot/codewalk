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

/** A staged line comment: an anchor plus the text left on it. */
export interface LineComment extends LineAnchor {
  text: string;
}

export interface DiffStep {
  kind: "diff";
  title?: string;
  note?: string;
  /** Cosmetic progress label (e.g. "1/4") shown in the reviewer header. */
  progress?: string;
  files: DiffFile[];
  comments: Comment[];
}

export type Step = DiffStep;

/**
 * A codewalk session holds exactly one step — the one on stage. The tool does
 * not accumulate a backlog: authoring the next step overwrites this one, which
 * is what forces the walk to advance one live step at a time.
 */
export interface Session {
  title: string;
  createdAt: string;
  step: Step | null;
}

/** Where a reply came from. */
export type ReplySource = "pane" | "web" | "cli";

/**
 * A message from the human back to the agent. Replies land in the inbox
 * (`.codewalk/replies/`) regardless of render target, and a blocking
 * `walk await` pipes the next unconsumed one back into the conversation.
 */
/**
 * One submission from the human: an overall message plus any line comments they
 * staged before completing the step. Sending is atomic — the reader stages as
 * many comments as they like, then completes the step, producing a single Reply
 * the agent consumes in one turn.
 */
export interface Reply {
  id: string;
  at: string;
  /** The focus sequence the reply was left under — i.e. which staged step it
   * belongs to. Only replies matching the current focus seq are displayed. */
  seq: number;
  /** The step's progress label when they replied (best-effort context). */
  stepId: string | null;
  /** The overall message ("" when the submission is only line comments). */
  text: string;
  source: ReplySource;
  /** Set when the reply was left on a specific diff line (click-to-comment). */
  anchor?: LineAnchor;
  /** Line comments staged during this step and submitted together. */
  comments?: LineComment[];
}

/**
 * A bump signal for the live reviewer. `seq` increments on every `present`,
 * which is how a running reviewer (pane or browser) knows the agent advanced
 * and it should re-render the current step and prompt again.
 */
export interface Focus {
  seq: number;
  at: string;
  /** Set by `walk finish`: the walk is complete. Reviewers show a done screen
   * (and the pane closes itself). */
  done?: boolean;
  /** Optional closing note shown on the completion screen. */
  summary?: string;
}
