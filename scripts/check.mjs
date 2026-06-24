import concurrently from "concurrently";
import { commandPlan } from "./check-plan.mjs";

const args = process.argv.slice(2);
const validArgs = new Set(["--ci", "--lint"]);
const unknownArgs = args.filter((arg) => !validArgs.has(arg));

if (unknownArgs.length > 0) {
  console.error("Usage: node scripts/check.mjs [--ci] [--lint]");
  process.exit(1);
}

const ciMode = args.includes("--ci");
const lintOnly = args.includes("--lint");
const concurrentOptions = {
  group: true,
  padPrefix: true,
  prefix: "name",
};

try {
  const plan = commandPlan({ ciMode, lintOnly });
  for (const phase of plan.phases) {
    await runConcurrently(phase.commands);
  }
} catch {
  process.exit(1);
}

async function runConcurrently(commands) {
  await concurrently(commands, concurrentOptions).result;
}
