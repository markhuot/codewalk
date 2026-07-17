// Bundle the CLI into a single Node-runnable file (dist/cli.js). Sources use
// Bun for dev convenience, but the published binary targets Node so anyone can
// `npx @markhuot/codewalk …` without Bun installed.

import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const result = await Bun.build({
  entrypoints: ["./src/cli.ts"],
  outdir: "./dist",
  target: "node",
  format: "esm",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Ensure a Node shebang (the source carries a Bun one for dev) and make it executable.
const out = "./dist/cli.js";
let code = readFileSync(out, "utf8");
code = code.replace(/^#![^\n]*\n/, "");
writeFileSync(out, `#!/usr/bin/env node\n${code}`);
chmodSync(out, 0o755);

console.log(`Built ${out}`);
