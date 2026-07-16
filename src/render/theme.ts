// Light/dark theming for the terminal renderer. The diff "bands" (the tinted
// backgrounds behind added/removed lines) are truecolor, so they must match the
// terminal's background or they look wrong. We pick a theme from, in order:
//   1. CODEWALK_THEME=light|dark (explicit override)
//   2. COLORFGBG (many terminals export "fg;bg"; a light bg digit means light)
//   3. dark (default)
// Syntax token colors come from the highlighter and read fine on either ground.

export type Theme = "light" | "dark";

export function terminalTheme(): Theme {
  const explicit = process.env.CODEWALK_THEME;
  if (explicit === "light" || explicit === "dark") return explicit;

  const cfb = process.env.COLORFGBG;
  if (cfb) {
    const bg = parseInt(cfb.split(";").pop() ?? "", 10);
    // 0–6 and 8 are dark backgrounds; 7 and 15 (and other high values) are light.
    if (!Number.isNaN(bg)) return bg === 7 || bg >= 9 ? "light" : "dark";
  }
  return "dark";
}

export interface BandColors {
  addBg: string;
  delBg: string;
  addMark: string;
  delMark: string;
}

const THEMES: Record<Theme, BandColors> = {
  dark: {
    addBg: "\x1b[48;2;18;38;30m",
    delBg: "\x1b[48;2;42;22;27m",
    addMark: "\x1b[38;2;87;171;90m",
    delMark: "\x1b[38;2;229;115;115m",
  },
  light: {
    addBg: "\x1b[48;2;225;247;231m",
    delBg: "\x1b[48;2;255;235;233m",
    addMark: "\x1b[38;2;26;127;55m",
    delMark: "\x1b[38;2;207;34;46m",
  },
};

export function bandColors(): BandColors {
  return THEMES[terminalTheme()];
}
