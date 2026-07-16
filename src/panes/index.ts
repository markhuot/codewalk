// The pane-driver registry. To add a new multiplexer (cmux, kitty, wezterm, …),
// implement PaneDriver and add it to DRIVERS — detection order is first-match,
// so list more specific environments first.

import type { PaneDriver } from "./types.ts";
import { herdrDriver } from "./herdr.ts";
import { tmuxDriver } from "./tmux.ts";

export type { PaneDriver, SplitOptions } from "./types.ts";

export const DRIVERS: PaneDriver[] = [herdrDriver, tmuxDriver];

/** The driver for the current environment, or null when none is detected. */
export function activeDriver(): PaneDriver | null {
  return DRIVERS.find((d) => d.detect()) ?? null;
}

/** Names of drivers whose multiplexer is currently available. */
export function detectedDrivers(): string[] {
  return DRIVERS.filter((d) => d.detect()).map((d) => d.name);
}
