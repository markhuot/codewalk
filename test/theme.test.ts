import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { terminalTheme, bandColors } from "../src/render/theme.ts";

const KEYS = ["CODEWALK_THEME", "COLORFGBG"];
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

describe("terminal theme detection", () => {
  test("defaults to dark", () => {
    expect(terminalTheme()).toBe("dark");
  });

  test("CODEWALK_THEME overrides everything", () => {
    process.env.COLORFGBG = "0;15"; // would say light
    process.env.CODEWALK_THEME = "dark";
    expect(terminalTheme()).toBe("dark");
  });

  test("COLORFGBG light background → light", () => {
    process.env.COLORFGBG = "0;15";
    expect(terminalTheme()).toBe("light");
  });

  test("COLORFGBG dark background → dark", () => {
    process.env.COLORFGBG = "15;0";
    expect(terminalTheme()).toBe("dark");
  });

  test("bandColors differ between themes", () => {
    process.env.CODEWALK_THEME = "dark";
    const dark = bandColors().addBg;
    process.env.CODEWALK_THEME = "light";
    const light = bandColors().addBg;
    expect(dark).not.toBe(light);
  });
});
