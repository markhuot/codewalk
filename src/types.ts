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
