import { spawnSync } from "node:child_process";

function fail(message) {
  console.error(`release preflight failed: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.error) fail(`${command} ${args.join(" ")}: ${result.error.message}`);
  if (result.status !== 0) {
    if (options.capture) {
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      if (output) console.error(output);
    }
    fail(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function maybeRun(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

const branch = run("git", ["branch", "--show-current"], { capture: true });
if (branch !== "main") fail(`release must be prepared from main, got ${branch || "(detached HEAD)"}`);

const status = run("git", ["status", "--short"], { capture: true });
if (status) fail(`working tree must be clean before release preflight\n${status}`);

const upstream = maybeRun("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
if (!upstream) fail("main must have an upstream tracking branch");

const upstreamAncestor = spawnSync("git", ["merge-base", "--is-ancestor", upstream, "HEAD"], {
  encoding: "utf8",
  stdio: "pipe",
  shell: false,
});
if (upstreamAncestor.status !== 0) fail(`HEAD must contain ${upstream}; pull or rebase before tagging`);

const packageVersion = run("node", ["-p", "require('./package.json').version"], { capture: true });
const existingTag = run("git", ["tag", "--list", packageVersion], { capture: true });
if (existingTag) fail(`local tag ${packageVersion} already exists`);

run("npm", ["run", "release:check"]);
run("npm", ["ci", "--dry-run"]);
run("npm", ["run", "check"]);

console.log(`release preflight passed for ${packageVersion}`);
