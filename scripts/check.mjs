import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

for (const arg of args) {
  if (arg !== "--ci") {
    console.error("Usage: node scripts/check.mjs [--ci]");
    process.exit(1);
  }
}

if (args.has("--ci")) {
  for (const script of ["typecheck:ci", "test:ci", "lint:ts:ci", "lint:css", "format:check:ci", "build:styles:check", "unused", "build"]) {
    run(npmCommand, ["run", script]);
  }
} else {
  run("node", ["scripts/run-parallel.mjs", "typecheck", "test", "lint:ts", "lint:css", "format:check", "build:styles:check", "unused"]);
  run(npmCommand, ["run", "build"]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(`Failed to run ${command} ${args.join(" ")}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
