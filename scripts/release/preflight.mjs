import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`release preflight failed: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawn(command, args, options);
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
  const result = spawn(command, args, { capture: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function spawn(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
  });
}

function assertGitReleaseState(packageVersion) {
  const branch = run("git", ["branch", "--show-current"], { capture: true });
  if (branch !== "main") fail(`release must be prepared from main, got ${branch || "(detached HEAD)"}`);

  const status = run("git", ["status", "--short"], { capture: true });
  if (status) fail(`working tree must be clean before release preflight\n${status}`);

  const upstream = maybeRun("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream) fail("main must have an upstream tracking branch");

  const upstreamAncestor = spawn("git", ["merge-base", "--is-ancestor", upstream, "HEAD"], { capture: true });
  if (upstreamAncestor.status !== 0) fail(`HEAD must contain ${upstream}; pull or rebase before tagging`);

  const existingTag = run("git", ["tag", "--list", packageVersion], { capture: true });
  if (existingTag) fail(`local tag ${packageVersion} already exists`);
}

function jjCommitId(revision) {
  return run("jj", ["log", "-r", revision, "--no-graph", "-T", 'commit_id ++ "\\n"'], { capture: true });
}

function jjRevisionCount(revision) {
  return Number(run("jj", ["log", "-r", revision, "--count"], { capture: true }));
}

function assertJujutsuReleaseState(packageVersion) {
  const workingCopyDiff = run("jj", ["diff", "--summary", "-r", "@"], { capture: true });
  if (workingCopyDiff) fail(`Jujutsu working-copy commit must be empty before release preflight\n${workingCopyDiff}`);

  const mainCommit = jjCommitId("main");
  const workingCopyParent = jjCommitId("@-");
  if (mainCommit !== workingCopyParent) {
    fail("main bookmark must point to the release commit and be the parent of the empty working-copy commit");
  }

  const existingTag = run("jj", ["tag", "list", packageVersion], { capture: true });
  if (existingTag) fail(`local tag ${packageVersion} already exists`);

  if (jjRevisionCount("main@origin & ::main") !== 1) {
    fail("main@origin must be an ancestor of main; fetch or rebase before tagging");
  }
}

const packageVersion = run("node", ["-p", "require('./package.json').version"], { capture: true });
if (maybeRun("jj", ["root"])) {
  assertJujutsuReleaseState(packageVersion);
} else {
  assertGitReleaseState(packageVersion);
}

const versionKeys = Object.keys(JSON.parse(readFileSync("versions.json", "utf8")));
const previousTag = versionKeys.at(-2);
if (!previousTag) fail("versions.json must contain a release before the prepared version");
run("git", ["rev-parse", "--verify", `refs/tags/${previousTag}`], { capture: true });
run("npm", ["run", "commitlint", "--", "--from", previousTag, "--to", "main", "--verbose"]);
run("npm", ["run", "release:check"]);
run("npm", ["run", "api:baseline"]);
run("npm", ["ci", "--dry-run"]);
run("npm", ["run", "check"]);

console.log(`release preflight passed for ${packageVersion}`);
