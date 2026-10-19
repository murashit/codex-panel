import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function fail(message) {
  console.error(`release check failed: ${message}`);
  process.exitCode = 1;
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `exit status ${result.status}`;
    throw new Error(`release check failed: git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLockJson = JSON.parse(await readFile("package-lock.json", "utf8"));
const manifestJson = JSON.parse(await readFile("manifest.json", "utf8"));
const versionsJson = JSON.parse(await readFile("versions.json", "utf8"));

const releaseVersion = process.env.RELEASE_VERSION || packageJson.version;
const currentVersion = parseVersion(releaseVersion);

if (!currentVersion) fail(`release version must be X.Y.Z, got ${releaseVersion}`);
if (packageJson.version !== releaseVersion) fail(`package.json version ${packageJson.version} does not match ${releaseVersion}`);
if (packageLockJson.version !== releaseVersion) {
  fail(`package-lock.json version ${packageLockJson.version} does not match ${releaseVersion}`);
}
if (packageLockJson.packages?.[""]?.version !== releaseVersion) {
  fail(`package-lock root package version ${packageLockJson.packages?.[""]?.version} does not match ${releaseVersion}`);
}
if (manifestJson.version !== releaseVersion) fail(`manifest.json version ${manifestJson.version} does not match ${releaseVersion}`);
const versionKeys = Object.keys(versionsJson);
for (const versionKey of versionKeys) {
  const version = parseVersion(versionKey);
  if (!version) {
    fail(`versions.json contains invalid version ${versionKey}`);
  } else if (currentVersion && compareVersions(version, currentVersion) > 0) {
    fail(`versions.json entry ${versionKey} is newer than release ${releaseVersion}`);
  }
}

// Compare the candidate with the latest reachable release, including ordinary PRs
// that raise the runtime floor before tagpr proposes the next version.
const previousTag = process.env.PREVIOUS_RELEASE_TAG || runGit(["describe", "--tags", "--abbrev=0", "HEAD"]);
const previousManifest = JSON.parse(runGit(["show", `${previousTag}:manifest.json`]));
if (previousManifest.minAppVersion !== manifestJson.minAppVersion && versionsJson[previousTag] !== previousManifest.minAppVersion) {
  fail(`versions.json must map the last compatible release ${previousTag} to ${previousManifest.minAppVersion}`);
}

if (process.exitCode) process.exit();
console.log(`release check passed for ${releaseVersion}`);
