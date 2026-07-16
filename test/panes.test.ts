import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DRIVERS, activeDriver, detectedDrivers } from "../src/panes/index.ts";

// detect() reads process.env live, so isolate the multiplexer-related keys.
const KEYS = ["HERDR_ENV", "HERDR_SOCKET_PATH", "TMUX"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("pane drivers", () => {
  test("registry exposes the known drivers by name", () => {
    expect(DRIVERS.map((d) => d.name)).toEqual(["herdr", "tmux"]);
  });

  test("selects tmux when only $TMUX is set", () => {
    process.env.TMUX = "/tmp/tmux-501/default,1234,0";
    expect(activeDriver()?.name).toBe("tmux");
    expect(detectedDrivers()).toEqual(["tmux"]);
  });

  test("prefers herdr when both are present (first match wins)", () => {
    process.env.HERDR_ENV = "1";
    process.env.HERDR_SOCKET_PATH = "/tmp/herdr.sock";
    process.env.TMUX = "/tmp/tmux/default,1,0";
    expect(activeDriver()?.name).toBe("herdr");
    expect(detectedDrivers()).toEqual(["herdr", "tmux"]);
  });

  test("returns null when no multiplexer is detected", () => {
    expect(activeDriver()).toBeNull();
    expect(detectedDrivers()).toEqual([]);
  });
});
