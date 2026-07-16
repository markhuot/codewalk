import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Step, Walk } from "./types.ts";

/** Root directory for walk state. Override with CODEWALK_DIR. */
export function stateDir(): string {
  return process.env.CODEWALK_DIR || join(process.cwd(), ".codewalk");
}

function ensureDir(): string {
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function walkPath(id: string): string {
  return join(stateDir(), `${id}.json`);
}

function currentPointerPath(): string {
  return join(stateDir(), "current");
}

let counter = 0;
function makeId(prefix: string): string {
  // Deterministic within a process; unique across processes via time-ish salt
  // derived from the existing files so we never collide with a prior walk.
  counter += 1;
  const salt = readdirSync(ensureDir()).length + counter;
  return `${prefix}-${salt.toString(36)}-${process.pid.toString(36)}`;
}

export function createWalk(title: string): Walk {
  ensureDir();
  const walk: Walk = {
    id: makeId("walk"),
    title,
    createdAt: new Date().toISOString(),
    steps: [],
  };
  saveWalk(walk);
  setCurrent(walk.id);
  return walk;
}

export function saveWalk(walk: Walk): void {
  ensureDir();
  writeFileSync(walkPath(walk.id), JSON.stringify(walk, null, 2));
}

export function loadWalk(id: string): Walk {
  const raw = readFileSync(walkPath(id), "utf8");
  return JSON.parse(raw) as Walk;
}

export function setCurrent(id: string): void {
  ensureDir();
  writeFileSync(currentPointerPath(), id);
}

export function currentId(): string | null {
  const p = currentPointerPath();
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").trim() || null;
}

export function loadCurrent(): Walk {
  const id = currentId();
  if (!id) throw new Error("No active walk. Run `walk start \"<title>\"` first.");
  return loadWalk(id);
}

export function addStep(step: Step): Walk {
  const walk = loadCurrent();
  walk.steps.push(step);
  saveWalk(walk);
  return walk;
}

export function nextStepId(walk: Walk, kind: string): string {
  const n = walk.steps.filter((s) => s.kind === kind).length + 1;
  return `${kind}-${n}`;
}

export function listWalks(): { id: string; title: string; steps: number }[] {
  const dir = stateDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const w = JSON.parse(readFileSync(join(dir, f), "utf8")) as Walk;
        return { id: w.id, title: w.title, steps: w.steps.length };
      } catch {
        return null;
      }
    })
    .filter((x): x is { id: string; title: string; steps: number } => x != null);
}
