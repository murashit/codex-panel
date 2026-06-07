import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [
  { local: "typecheck", ci: "typecheck:ci", localPhase: "parallel" },
  { local: "test", ci: "test:ci", localPhase: "parallel" },
  { local: "lint:ts", ci: "lint:ts:ci", localPhase: "parallel" },
  { local: "lint:css", ci: "lint:css", localPhase: "parallel" },
  { local: "format:check", ci: "format:check:ci", localPhase: "parallel" },
  { local: "build:styles:check", ci: "build:styles:check", localPhase: "parallel" },
  { local: "unused", ci: "unused", localPhase: "parallel" },
  { local: "build", ci: "build", localPhase: "sequential" },
];

for (const arg of args) {
  if (arg !== "--ci") {
    console.error("Usage: node scripts/check.mjs [--ci]");
    process.exit(1);
  }
}

if (args.has("--ci")) {
  for (const check of checks) run(npmCommand, ["run", check.ci]);
} else {
  const parallelScripts = checks.filter((check) => check.localPhase === "parallel").map((check) => check.local);
  run("node", ["scripts/run-parallel.mjs", ...parallelScripts]);
  for (const check of checks.filter((check) => check.localPhase === "sequential")) run(npmCommand, ["run", check.local]);
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
